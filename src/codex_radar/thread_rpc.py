from __future__ import annotations

import json
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Callable, Dict, IO, Optional


DEFAULT_REQUEST_TIMEOUT = 30.0
DEFAULT_TURN_TIMEOUT = 300.0
MAX_CHILDREN_PER_THREAD = 4
MAX_RECURSION_DEPTH = 2
MAX_MESSAGE_LENGTH = 16_384
MAX_TOOL_OUTPUT_LENGTH = 32_768


class ThreadRpcError(RuntimeError):
    def __init__(self, code: str, detail: Any = None) -> None:
        super().__init__(code)
        self.code = code
        self.detail = detail


@dataclass
class _PendingRequest:
    event: threading.Event
    result: Any = None
    error: Any = None


class AppServerClient:
    """Small bidirectional JSONL client for the experimental Codex app-server."""

    def __init__(
        self,
        codex_command: str = "codex",
        *,
        request_timeout: float = DEFAULT_REQUEST_TIMEOUT,
        process_factory: Callable[..., subprocess.Popen[str]] = subprocess.Popen,
    ) -> None:
        self.codex_command = codex_command
        self.request_timeout = request_timeout
        self.process_factory = process_factory
        self.process: Optional[subprocess.Popen[str]] = None
        self._next_id = 1
        self._pending: Dict[int, _PendingRequest] = {}
        self._pending_lock = threading.Lock()
        self._write_lock = threading.Lock()
        self._turn_condition = threading.Condition()
        self._completed_turns: Dict[str, Dict[str, Any]] = {}
        self._closed_error: Optional[str] = None
        self._executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="radar-tool")
        self.server_request_handler: Optional[Callable[[str, Dict[str, Any]], Any]] = None

    def start(self) -> Dict[str, Any]:
        if self.process is not None:
            raise ThreadRpcError("app_server_already_started")
        self.process = self.process_factory(
            [self.codex_command, "app-server", "--stdio"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        if self.process.stdin is None or self.process.stdout is None:
            raise ThreadRpcError("app_server_stdio_unavailable")
        threading.Thread(target=self._read_stdout, daemon=True).start()
        if self.process.stderr is not None:
            threading.Thread(target=self._drain_stderr, daemon=True).start()
        result = self.request(
            "initialize",
            {
                "clientInfo": {
                    "name": "codex_radar_thread_rpc",
                    "title": "Codex Radar Thread RPC",
                    "version": "0.1",
                },
                "capabilities": {"experimentalApi": True},
            },
        )
        self.notify("initialized", {})
        return result if isinstance(result, dict) else {}

    def _drain_stderr(self) -> None:
        process = self.process
        if process is None or process.stderr is None:
            return
        for _line in process.stderr:
            pass

    def _read_stdout(self) -> None:
        process = self.process
        if process is None or process.stdout is None:
            return
        try:
            for line in process.stdout:
                try:
                    message = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(message, dict):
                    self._handle_message(message)
        finally:
            self._fail_all("app_server_closed")

    def _handle_message(self, message: Dict[str, Any]) -> None:
        request_id = message.get("id")
        method = message.get("method")
        if request_id is not None and method:
            self._executor.submit(self._handle_server_request, request_id, method, message.get("params"))
            return
        if request_id is not None:
            with self._pending_lock:
                pending = self._pending.pop(int(request_id), None)
            if pending is not None:
                pending.result = message.get("result")
                pending.error = message.get("error")
                pending.event.set()
            return
        if method == "turn/completed":
            params = message.get("params") or {}
            turn = params.get("turn") or {}
            turn_id = str(turn.get("id") or turn.get("turnId") or "")
            if turn_id:
                with self._turn_condition:
                    self._completed_turns[turn_id] = params
                    self._turn_condition.notify_all()

    def _handle_server_request(self, request_id: Any, method: str, params: Any) -> None:
        try:
            if self.server_request_handler is None:
                raise ThreadRpcError("server_request_not_supported")
            result = self.server_request_handler(method, params if isinstance(params, dict) else {})
            self._write({"id": request_id, "result": result})
        except Exception:
            self._write(
                {
                    "id": request_id,
                    "error": {"code": -32601, "message": "server_request_declined"},
                }
            )

    def _write(self, message: Dict[str, Any]) -> None:
        process = self.process
        if process is None or process.stdin is None:
            raise ThreadRpcError("app_server_not_running")
        with self._write_lock:
            process.stdin.write(json.dumps(message, separators=(",", ":")) + "\n")
            process.stdin.flush()

    def request(self, method: str, params: Dict[str, Any], timeout: Optional[float] = None) -> Any:
        with self._pending_lock:
            request_id = self._next_id
            self._next_id += 1
            pending = _PendingRequest(threading.Event())
            self._pending[request_id] = pending
        self._write({"id": request_id, "method": method, "params": params})
        if not pending.event.wait(timeout or self.request_timeout):
            with self._pending_lock:
                self._pending.pop(request_id, None)
            raise ThreadRpcError("app_server_request_timeout")
        if pending.error is not None:
            raise ThreadRpcError("app_server_request_failed", {"method": method, "error": pending.error})
        return pending.result

    def notify(self, method: str, params: Dict[str, Any]) -> None:
        self._write({"method": method, "params": params})

    def wait_turn(self, turn_id: str, timeout: float = DEFAULT_TURN_TIMEOUT) -> Dict[str, Any]:
        with self._turn_condition:
            if turn_id not in self._completed_turns:
                self._turn_condition.wait_for(
                    lambda: turn_id in self._completed_turns or self._closed_error is not None,
                    timeout=timeout,
                )
            completed = self._completed_turns.pop(turn_id, None)
        if completed is None:
            raise ThreadRpcError("turn_completion_timeout")
        return completed

    def _fail_all(self, reason: str) -> None:
        self._closed_error = reason
        with self._pending_lock:
            pending = list(self._pending.values())
            self._pending.clear()
        for item in pending:
            item.error = reason
            item.event.set()
        with self._turn_condition:
            self._turn_condition.notify_all()

    def close(self) -> None:
        process = self.process
        self.process = None
        if process is not None:
            try:
                if process.stdin is not None:
                    process.stdin.close()
            except OSError:
                pass
            try:
                process.terminate()
            except OSError:
                pass
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                try:
                    process.kill()
                    process.wait(timeout=2)
                except (OSError, subprocess.TimeoutExpired):
                    pass
        self._executor.shutdown(wait=False, cancel_futures=True)


def _function_tool(name: str, description: str, properties: Dict[str, Any], required: list[str]) -> Dict[str, Any]:
    return {
        "type": "function",
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "additionalProperties": False,
            "properties": properties,
            "required": required,
        },
    }


def _compact_thread(thread: Any) -> Dict[str, Any]:
    if not isinstance(thread, dict):
        return {}
    return {
        key: thread[key]
        for key in ("id", "title", "name", "status", "createdAt", "updatedAt", "threadSource")
        if key in thread and thread[key] is not None
    }


def _thread_items(result: Any) -> list[Any]:
    if isinstance(result, list):
        return result
    if not isinstance(result, dict):
        return []
    for key in ("data", "threads", "items"):
        if isinstance(result.get(key), list):
            return result[key]
    return []


class CodexThreadHost:
    def __init__(
        self,
        client: AppServerClient,
        *,
        max_children: int = MAX_CHILDREN_PER_THREAD,
        max_depth: int = MAX_RECURSION_DEPTH,
    ) -> None:
        self.client = client
        self.max_children = max_children
        self.max_depth = max_depth
        self.depths: Dict[str, int] = {}
        self.child_counts: Dict[str, int] = {}
        self._limits_lock = threading.Lock()
        self.client.server_request_handler = self.handle_server_request

    @staticmethod
    def dynamic_tools() -> list[Dict[str, Any]]:
        return [
            _function_tool(
                "create_thread",
                "Create a Radar-hosted Codex thread with the same bounded thread tools.",
                {
                    "prompt": {"type": "string"},
                    "cwd": {"type": "string"},
                    "model": {"type": "string"},
                    "thinking": {"type": "string"},
                },
                ["prompt"],
            ),
            _function_tool(
                "list_threads",
                "List compact host-local Codex thread records.",
                {"limit": {"type": "integer", "minimum": 1, "maximum": 100}},
                [],
            ),
            _function_tool(
                "read_thread",
                "Read one Codex thread with bounded turn history.",
                {
                    "threadId": {"type": "string"},
                    "turnLimit": {"type": "integer", "minimum": 1, "maximum": 20},
                },
                ["threadId"],
            ),
            _function_tool(
                "send_message_to_thread",
                "Send one follow-up message to a Codex thread and await completion.",
                {
                    "threadId": {"type": "string"},
                    "prompt": {"type": "string"},
                },
                ["threadId", "prompt"],
            ),
        ]

    def start_thread(
        self,
        *,
        prompt: Optional[str] = None,
        cwd: Optional[str] = None,
        model: Optional[str] = None,
        effort: Optional[str] = None,
        parent_thread_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        depth = 0
        child_slot_reserved = False
        if parent_thread_id:
            with self._limits_lock:
                depth = self.depths.get(parent_thread_id, 0) + 1
                if depth > self.max_depth:
                    raise ThreadRpcError("thread_recursion_limit")
                count = self.child_counts.get(parent_thread_id, 0)
                if count >= self.max_children:
                    raise ThreadRpcError("thread_child_limit")
                self.child_counts[parent_thread_id] = count + 1
                child_slot_reserved = True
        params: Dict[str, Any] = {
            "approvalPolicy": "never",
            "dynamicTools": self.dynamic_tools(),
            "threadSource": "codex-radar-thread-rpc",
            "sessionStartSource": "startup",
        }
        if cwd:
            params["cwd"] = cwd
        if model:
            params["model"] = model
        try:
            response = self.client.request("thread/start", params)
            thread = response.get("thread", {}) if isinstance(response, dict) else {}
            thread_id = str(thread.get("id") or "")
            if not thread_id:
                raise ThreadRpcError("thread_start_missing_id")
        except Exception:
            if child_slot_reserved and parent_thread_id:
                with self._limits_lock:
                    self.child_counts[parent_thread_id] -= 1
            raise
        with self._limits_lock:
            self.depths[thread_id] = depth
        result: Dict[str, Any] = {"threadId": thread_id, "thread": _compact_thread(thread)}
        if prompt:
            result["turn"] = self.send_message(
                thread_id,
                prompt,
                model=model,
                effort=effort,
                resume=False,
            )
        return result

    def list_threads(self, limit: int = 20) -> Dict[str, Any]:
        bounded = max(1, min(int(limit), 100))
        active = self.client.request(
            "thread/list",
            {"archived": False, "limit": bounded, "sortKey": "updated_at", "sortDirection": "desc"},
        )
        archived = self.client.request(
            "thread/list",
            {"archived": True, "limit": bounded, "sortKey": "updated_at", "sortDirection": "desc"},
        )
        return {
            "active": [_compact_thread(item) for item in _thread_items(active)],
            "archived": [_compact_thread(item) for item in _thread_items(archived)],
        }

    def read_thread(self, thread_id: str, turn_limit: int = 8) -> Any:
        response = self.client.request(
            "thread/read",
            {"threadId": thread_id, "includeTurns": True},
        )
        bounded = max(1, min(int(turn_limit), 20))
        if isinstance(response, dict):
            thread = response.get("thread")
            if isinstance(thread, dict) and isinstance(thread.get("turns"), list):
                response = dict(response)
                response["thread"] = dict(thread)
                response["thread"]["turns"] = thread["turns"][-bounded:]
        return response

    def send_message(
        self,
        thread_id: str,
        prompt: str,
        *,
        model: Optional[str] = None,
        effort: Optional[str] = None,
        resume: bool = True,
    ) -> Dict[str, Any]:
        if not prompt or len(prompt) > MAX_MESSAGE_LENGTH:
            raise ThreadRpcError("invalid_message_length")
        if resume:
            self.client.request("thread/resume", {"threadId": thread_id})
        params: Dict[str, Any] = {
            "threadId": thread_id,
            "input": [{"type": "text", "text": prompt}],
        }
        if model:
            params["model"] = model
        if effort:
            params["effort"] = effort
        response = self.client.request("turn/start", params)
        turn = response.get("turn", {}) if isinstance(response, dict) else {}
        turn_id = str(turn.get("id") or turn.get("turnId") or "")
        if not turn_id:
            raise ThreadRpcError("turn_start_missing_id")
        return self.client.wait_turn(turn_id)

    def handle_server_request(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        if method != "item/tool/call":
            raise ThreadRpcError("server_request_not_supported")
        try:
            tool = str(params.get("tool") or "")
            arguments = params.get("arguments")
            args = arguments if isinstance(arguments, dict) else {}
            parent_thread_id = str(params.get("threadId") or "")
            if tool == "create_thread":
                prompt = str(args.get("prompt") or "")
                if not prompt:
                    raise ThreadRpcError("invalid_message_length")
                value = self.start_thread(
                    prompt=prompt,
                    cwd=str(args.get("cwd") or "") or None,
                    model=str(args.get("model") or "") or None,
                    effort=str(args.get("thinking") or "") or None,
                    parent_thread_id=parent_thread_id,
                )
            elif tool == "list_threads":
                value = self.list_threads(int(args.get("limit") or 20))
            elif tool == "read_thread":
                value = self.read_thread(
                    str(args.get("threadId") or ""),
                    int(args.get("turnLimit") or 8),
                )
            elif tool == "send_message_to_thread":
                value = self.send_message(
                    str(args.get("threadId") or ""),
                    str(args.get("prompt") or ""),
                )
            else:
                raise ThreadRpcError("unknown_dynamic_tool")
        except (TypeError, ValueError, ThreadRpcError) as exc:
            code = exc.code if isinstance(exc, ThreadRpcError) else "invalid_tool_arguments"
            return {
                "success": False,
                "contentItems": [{"type": "inputText", "text": json.dumps({"error": code})}],
            }
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        if len(text) > MAX_TOOL_OUTPUT_LENGTH:
            text = json.dumps(
                {
                    "truncated": True,
                    "preview": text[: (MAX_TOOL_OUTPUT_LENGTH - 256) // 2],
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
        return {"success": True, "contentItems": [{"type": "inputText", "text": text}]}


def run_thread_rpc(
    *,
    codex_command: str = "codex",
    stdin: IO[str] = sys.stdin,
    stdout: IO[str] = sys.stdout,
    client_factory: Callable[[str], AppServerClient] = AppServerClient,
) -> int:
    client = client_factory(codex_command)
    host = CodexThreadHost(client)
    try:
        initialize = client.start()
        for line in stdin:
            if not line.strip():
                continue
            request_id: Any = None
            try:
                message = json.loads(line)
                if not isinstance(message, dict):
                    raise ThreadRpcError("invalid_rpc_message")
                request_id = message.get("id")
                method = str(message.get("method") or "")
                params = message.get("params") if isinstance(message.get("params"), dict) else {}
                if method == "initialize":
                    result: Any = {
                        "protocol": "codex-radar.thread-rpc",
                        "version": 1,
                        "appServer": {
                            key: initialize[key]
                            for key in ("userAgent", "platformFamily", "platformOs")
                            if key in initialize
                        },
                    }
                elif method == "thread/start":
                    result = host.start_thread(
                        prompt=str(params.get("prompt") or "") or None,
                        cwd=str(params.get("cwd") or "") or None,
                        model=str(params.get("model") or "") or None,
                        effort=str(params.get("effort") or "") or None,
                    )
                elif method == "thread/list":
                    result = host.list_threads(int(params.get("limit") or 20))
                elif method == "thread/read":
                    result = host.read_thread(
                        str(params.get("threadId") or ""),
                        int(params.get("turnLimit") or 8),
                    )
                elif method == "thread/send":
                    result = host.send_message(
                        str(params.get("threadId") or ""),
                        str(params.get("prompt") or ""),
                    )
                elif method == "shutdown":
                    result = {"stopped": True}
                    stdout.write(json.dumps({"id": request_id, "result": result}) + "\n")
                    stdout.flush()
                    return 0
                else:
                    raise ThreadRpcError("unknown_rpc_method")
                response = {"id": request_id, "result": result}
            except (ValueError, TypeError, ThreadRpcError, json.JSONDecodeError) as exc:
                code = exc.code if isinstance(exc, ThreadRpcError) else "invalid_rpc_request"
                response = {"id": request_id, "error": {"code": code}}
            stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
            stdout.flush()
    finally:
        client.close()
    return 0
