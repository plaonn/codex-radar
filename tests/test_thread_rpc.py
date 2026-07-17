import io
import json
import threading
import unittest
from unittest.mock import patch

from codex_radar.thread_rpc import (
    AppServerClient,
    CodexThreadHost,
    ThreadRpcError,
    diagnose_app_server,
    run_thread_action,
    run_thread_rpc,
)


class FakeClient:
    def __init__(self) -> None:
        self.server_request_handler = None
        self.calls = []
        self.thread_number = 0
        self.started = False
        self.closed = False

    def start(self):
        self.started = True
        return {"userAgent": "fake", "codexHome": "/private"}

    def close(self):
        self.closed = True

    def request(self, method, params, timeout=None):
        self.calls.append((method, params))
        if method == "thread/start":
            self.thread_number += 1
            return {"thread": {"id": f"thread-{self.thread_number}", "cwd": params.get("cwd")}}
        if method == "thread/list":
            return {"data": [{"id": "thread-1"}]}
        if method == "thread/read":
            return {"thread": {"id": params["threadId"]}, "turns": []}
        if method == "thread/resume":
            return {"thread": {"id": params["threadId"]}}
        if method == "turn/start":
            return {"turn": {"id": "turn-1"}}
        raise AssertionError(method)

    def wait_turn(self, turn_id, timeout=300):
        return {"threadId": "thread-1", "turn": {"id": turn_id, "status": "completed"}}


class ThreadRpcTests(unittest.TestCase):
    def test_dynamic_tools_use_canonical_tagged_specs(self) -> None:
        tools = CodexThreadHost.dynamic_tools()
        self.assertEqual(
            ["create_thread", "list_threads", "read_thread", "send_message_to_thread"],
            [tool["name"] for tool in tools],
        )
        self.assertTrue(all(tool["type"] == "function" for tool in tools))
        self.assertTrue(all(tool["inputSchema"]["additionalProperties"] is False for tool in tools))

    def test_started_threads_receive_all_dynamic_tools_and_never_approval(self) -> None:
        client = FakeClient()
        host = CodexThreadHost(client)

        result = host.start_thread(prompt="hello", cwd="/repo", model="gpt-test", effort="medium")

        self.assertEqual("thread-1", result["threadId"])
        method, params = client.calls[0]
        self.assertEqual("thread/start", method)
        self.assertEqual("never", params["approvalPolicy"])
        self.assertEqual(4, len(params["dynamicTools"]))
        self.assertEqual("codex-radar-thread-rpc", params["threadSource"])
        self.assertNotIn(("thread/resume", {"threadId": "thread-1"}), client.calls)

    def test_dynamic_create_thread_is_bounded_per_parent(self) -> None:
        client = FakeClient()
        host = CodexThreadHost(client, max_children=1, max_depth=1)
        parent = host.start_thread()["threadId"]
        params = {
            "threadId": parent,
            "tool": "create_thread",
            "arguments": {"prompt": "child"},
        }

        response = host.handle_server_request("item/tool/call", params)
        self.assertTrue(response["success"])
        failed = host.handle_server_request("item/tool/call", params)
        self.assertFalse(failed["success"])
        self.assertIn("thread_child_limit", failed["contentItems"][0]["text"])

    def test_dynamic_create_thread_rejects_empty_prompt(self) -> None:
        host = CodexThreadHost(FakeClient())

        response = host.handle_server_request(
            "item/tool/call",
            {"threadId": "parent", "tool": "create_thread", "arguments": {"prompt": ""}},
        )

        self.assertFalse(response["success"])
        self.assertIn("invalid_message_length", response["contentItems"][0]["text"])

    def test_dynamic_read_and_send_route_to_app_server_methods(self) -> None:
        client = FakeClient()
        host = CodexThreadHost(client)

        host.handle_server_request(
            "item/tool/call",
            {"threadId": "parent", "tool": "read_thread", "arguments": {"threadId": "target"}},
        )
        host.handle_server_request(
            "item/tool/call",
            {
                "threadId": "parent",
                "tool": "send_message_to_thread",
                "arguments": {"threadId": "target", "prompt": "next"},
            },
        )

        self.assertIn(
            ("thread/read", {"threadId": "target", "includeTurns": True}),
            client.calls,
        )
        self.assertIn(("thread/resume", {"threadId": "target"}), client.calls)

    def test_message_length_is_bounded(self) -> None:
        host = CodexThreadHost(FakeClient())
        with self.assertRaisesRegex(ThreadRpcError, "invalid_message_length"):
            host.send_message("thread", "x" * 16_385)

    def test_unknown_server_requests_are_declined(self) -> None:
        host = CodexThreadHost(FakeClient())
        with self.assertRaisesRegex(ThreadRpcError, "server_request_not_supported"):
            host.handle_server_request("item/commandExecution/requestApproval", {})

    def test_app_server_request_handler_replies_with_same_id_on_worker(self) -> None:
        client = AppServerClient()
        written = []
        completed = threading.Event()

        def write(message):
            written.append(message)
            completed.set()

        client._write = write
        client.server_request_handler = lambda method, params: {"method": method, "params": params}
        try:
            client._handle_message({"id": 41, "method": "item/tool/call", "params": {"tool": "x"}})
            self.assertTrue(completed.wait(1))
            self.assertEqual(41, written[0]["id"])
            self.assertEqual("item/tool/call", written[0]["result"]["method"])
        finally:
            client.close()

    def test_failed_child_start_releases_parent_slot(self) -> None:
        client = FakeClient()
        host = CodexThreadHost(client, max_children=1)
        parent = host.start_thread()["threadId"]
        original_request = client.request

        def failing_request(method, params, timeout=None):
            if method == "thread/start":
                raise ThreadRpcError("expected_failure")
            return original_request(method, params, timeout)

        client.request = failing_request
        with self.assertRaisesRegex(ThreadRpcError, "expected_failure"):
            host.start_thread(parent_thread_id=parent)
        self.assertEqual(0, host.child_counts[parent])

    def test_stdio_rpc_writes_only_protocol_responses(self) -> None:
        client = FakeClient()
        stdin = io.StringIO(
            json.dumps({"id": 1, "method": "initialize"})
            + "\n"
            + json.dumps({"id": 2, "method": "thread/list", "params": {"limit": 1}})
            + "\n"
            + json.dumps({"id": 3, "method": "shutdown"})
            + "\n"
        )
        stdout = io.StringIO()

        result = run_thread_rpc(
            stdin=stdin,
            stdout=stdout,
            client_factory=lambda _command: client,
        )

        self.assertEqual(0, result)
        messages = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertEqual([1, 2, 3], [message["id"] for message in messages])
        self.assertNotIn("codexHome", messages[0]["result"]["appServer"])
        self.assertTrue(client.started)
        self.assertTrue(client.closed)

    def test_one_shot_action_uses_the_same_host_lifecycle(self) -> None:
        client = FakeClient()

        result = run_thread_action(
            lambda host, initialize: {
                "userAgent": initialize["userAgent"],
                "threads": host.list_threads(1),
            },
            client_factory=lambda _command: client,
        )

        self.assertEqual("fake", result["userAgent"])
        self.assertEqual([{"id": "thread-1"}], result["threads"]["active"])
        self.assertTrue(client.started)
        self.assertTrue(client.closed)

    def test_diagnostic_reports_initialize_compatibility_without_thread_write(self) -> None:
        client = FakeClient()

        with patch("codex_radar.thread_rpc.subprocess.run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = "codex-cli 0.145.0"
            run.return_value.stderr = ""
            result = diagnose_app_server(client_factory=lambda _command: client)

        self.assertEqual("compatible", result["status"])
        self.assertEqual("codex-cli 0.145.0", result["version"])
        self.assertEqual([], client.calls)
        self.assertTrue(client.closed)
