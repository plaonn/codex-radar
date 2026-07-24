import importlib.util
import io
import json
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "read-protocol-stage0.py"
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "read-protocol-stage0-v1.json"
SPEC = importlib.util.spec_from_file_location("read_protocol_stage0", SCRIPT)
assert SPEC and SPEC.loader
protocol = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(protocol)


def _state(*sessions):
    return {
        "contract": "codex-radar.display-state",
        "version": 1,
        "generated_at": "2026-07-24T00:00:00+00:00",
        "source": {"status": "ready"},
        "capabilities": ["transcript-preview"],
        "counts": {"attention": 0, "running": 0},
        "sessions": list(sessions),
        "usage": {"available": False, "reason": "usage_unavailable"},
    }


class ReadProtocolStage0Tests(unittest.TestCase):
    def test_protocol_v1_matches_golden_fixture(self) -> None:
        fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        session = protocol.ReadProtocolSession(
            state_reader=lambda: _state(),
            preview_reader=lambda session_id, limit, version: {
                "contract": "codex-radar.transcript-preview",
                "version": version,
                "session_id": session_id,
                "limit": limit,
                "messages": [],
            },
        )

        observed = []
        for exchange in fixture["exchanges"]:
            messages, shutdown = session.handle(exchange["request"])
            observed.append(
                {
                    "request": exchange["request"],
                    "messages": messages,
                    "shutdown": shutdown,
                }
            )

        self.assertEqual("codex-radar.read-protocol", fixture["protocol"])
        self.assertEqual(1, fixture["version"])
        self.assertEqual(fixture["exchanges"], observed)

    def test_negotiates_versions_and_reuses_existing_contracts(self) -> None:
        session = protocol.ReadProtocolSession(
            state_reader=lambda: _state(),
            preview_reader=lambda session_id, limit, version: {
                "contract": "codex-radar.transcript-preview",
                "version": version,
                "session_id": session_id,
                "limit": limit,
                "messages": [],
            },
        )

        initialize, stopped = session.handle(
            {
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocol_versions": [1],
                    "preview_contract_versions": [1, 2],
                },
            }
        )
        state, _ = session.handle({"id": 2, "method": "state/read"})
        preview, _ = session.handle(
            {
                "id": 3,
                "method": "preview/read",
                "params": {"session_id": "session-1", "limit": 20},
            }
        )

        self.assertFalse(stopped)
        self.assertEqual("codex-radar.read-protocol", initialize[0]["result"]["protocol"])
        self.assertEqual(2, initialize[0]["result"]["preview_contract_version"])
        self.assertEqual("codex-radar.display-state", state[0]["result"]["contract"])
        self.assertEqual("codex-radar.transcript-preview", preview[0]["result"]["contract"])
        self.assertEqual(20, preview[0]["result"]["limit"])

    def test_attention_poll_emits_only_foreground_transition_events(self) -> None:
        states = iter(
            [
                _state(
                    {
                        "session_id": "running-1",
                        "project": "radar",
                        "display_status": "running",
                    }
                ),
                _state(
                    {
                        "session_id": "running-1",
                        "project": "radar",
                        "display_status": "done",
                    },
                    {
                        "session_id": "waiting-1",
                        "project": "radar",
                        "display_status": "waiting_approval",
                    },
                ),
            ]
        )
        session = protocol.ReadProtocolSession(
            state_reader=lambda: next(states),
            preview_reader=lambda _session_id, _limit, _version: {},
        )
        session.handle(
            {
                "id": "init",
                "method": "initialize",
                "params": {
                    "protocol_versions": [1],
                    "preview_contract_versions": [2],
                },
            }
        )

        baseline, _ = session.handle({"id": "poll-1", "method": "attention/poll"})
        changed, _ = session.handle({"id": "poll-2", "method": "attention/poll"})

        self.assertEqual(0, baseline[-1]["result"]["events_emitted"])
        self.assertEqual(["attention", "attention"], [item["event"] for item in changed[:-1]])
        self.assertEqual(
            [("running", "done"), ("unknown", "waiting_approval")],
            [
                (item["params"]["previous_status"], item["params"]["status"])
                for item in changed[:-1]
            ],
        )
        self.assertEqual(2, changed[-1]["result"]["events_emitted"])

    def test_reconnect_starts_a_fresh_attention_baseline(self) -> None:
        current = _state(
            {
                "session_id": "done-1",
                "project": "radar",
                "display_status": "done",
            }
        )
        for _attempt in range(2):
            session = protocol.ReadProtocolSession(
                state_reader=lambda: current,
                preview_reader=lambda _session_id, _limit, _version: {},
            )
            session.handle(
                {
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocol_versions": [1],
                        "preview_contract_versions": [2],
                    },
                }
            )
            messages, _ = session.handle({"id": 2, "method": "attention/poll"})
            self.assertEqual(1, len(messages))
            self.assertEqual(0, messages[0]["result"]["events_emitted"])

    def test_jsonl_loop_is_stdout_pure_and_uses_stable_errors(self) -> None:
        stdin = io.StringIO(
            "\n".join(
                [
                    '{"id":1,"method":"state/read"}',
                    "not-json",
                    '{"id":2,"method":"initialize","params":{"protocol_versions":[1],"preview_contract_versions":[2]}}',
                    '{"id":3,"method":"unknown"}',
                    '{"id":4,"method":"shutdown"}',
                ]
            )
            + "\n"
        )
        stdout = io.StringIO()
        stderr = io.StringIO()

        result = protocol.run_protocol(
            stdin,
            stdout,
            stderr,
            state_reader=lambda: _state(),
            preview_reader=lambda _session_id, _limit, _version: {},
        )

        messages = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertEqual(0, result)
        self.assertEqual("", stderr.getvalue())
        self.assertEqual("not_initialized", messages[0]["error"]["code"])
        self.assertEqual("invalid_json", messages[1]["error"]["code"])
        self.assertEqual("unknown_method", messages[3]["error"]["code"])
        self.assertEqual({"shutdown": True}, messages[4]["result"])

    def test_rejects_unnegotiated_preview_and_invalid_display_contract(self) -> None:
        session = protocol.ReadProtocolSession(
            state_reader=lambda: {"raw": "/private/path"},
            preview_reader=lambda _session_id, _limit, _version: {},
        )
        session.handle(
            {
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocol_versions": [1],
                    "preview_contract_versions": [1],
                },
            }
        )

        with self.assertRaisesRegex(protocol.ProtocolError, "preview_version_not_negotiated"):
            session.handle(
                {
                    "id": 2,
                    "method": "preview/read",
                    "params": {
                        "session_id": "session-1",
                        "limit": 10,
                        "contract_version": 2,
                    },
                }
            )
        with self.assertRaisesRegex(protocol.ProtocolError, "display_state_contract_invalid"):
            session.handle({"id": 3, "method": "state/read"})
