import json
import tempfile
import unittest
from pathlib import Path

from codex_radar.reconcile import latest_rollout_terminal_evidence, reconcile_sessions
from codex_radar.store import load_sessions


def write_rollout(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(row) + "\n" for row in rows),
        encoding="utf-8",
    )


def lifecycle(timestamp: str, event_type: str, turn_id: str) -> dict:
    return {
        "timestamp": timestamp,
        "type": "event_msg",
        "payload": {"type": event_type, "turn_id": turn_id},
    }


class ReconcileTests(unittest.TestCase):
    def test_reconcile_missing_state_is_noop_without_creating_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp) / "missing-state"

            result = reconcile_sessions(state_dir, dry_run=True)

            self.assertEqual(0, result["updated_count"])
            self.assertFalse(state_dir.exists())

    def test_latest_terminal_evidence_uses_latest_turn_and_final_message(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "rollout-session-1.jsonl"
            write_rollout(
                path,
                [
                    lifecycle("2026-07-17T00:00:00Z", "task_started", "turn-1"),
                    {
                        "timestamp": "2026-07-17T00:00:01Z",
                        "type": "response_item",
                        "payload": {
                            "type": "message",
                            "role": "assistant",
                            "phase": "final_answer",
                            "content": [{"type": "output_text", "text": "finished"}],
                            "internal_chat_message_metadata_passthrough": {"turn_id": "turn-1"},
                        },
                    },
                    lifecycle("2026-07-17T00:00:02Z", "task_complete", "turn-1"),
                ],
            )

            evidence = latest_rollout_terminal_evidence(path)

            self.assertEqual("done", evidence["status"])
            self.assertEqual("turn-1", evidence["turn_id"])
            self.assertEqual("finished", evidence["last_assistant_message"])

    def test_latest_started_turn_prevents_older_completion_from_winning(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "rollout-session-1.jsonl"
            write_rollout(
                path,
                [
                    lifecycle("2026-07-17T00:00:00Z", "task_complete", "turn-1"),
                    lifecycle("2026-07-17T00:01:00Z", "task_started", "turn-2"),
                ],
            )

            self.assertIsNone(latest_rollout_terminal_evidence(path))

    def test_reconcile_updates_stale_running_session_from_task_complete(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp) / "state"
            state_dir.mkdir()
            rollout = Path(tmp) / "rollout-session-1.jsonl"
            write_rollout(
                rollout,
                [
                    lifecycle("2026-07-17T00:00:00Z", "task_started", "turn-1"),
                    lifecycle("2026-07-17T00:02:00Z", "task_complete", "turn-1"),
                ],
            )
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "sessions": {
                            "session-1": {
                                "session_id": "session-1",
                                "status": "tool_running",
                                "display_state": "running",
                                "display_state_started_at": "2026-07-17T00:00:00+00:00",
                                "last_seen_at": "2026-07-17T00:01:00+00:00",
                                "last_event_name": "PreToolUse",
                                "transcript_path": str(rollout),
                                "turn_id": "turn-1",
                                "current_tool": "Bash",
                                "event_count": 3,
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            result = reconcile_sessions(state_dir)
            session = load_sessions(state_dir)["session-1"]

            self.assertEqual(1, result["updated_count"])
            self.assertEqual("done", session["status"])
            self.assertEqual("RolloutTaskComplete", session["last_event_name"])
            self.assertEqual("", session["current_tool"])
            self.assertEqual(4, session["event_count"])

    def test_reconcile_maps_interrupted_turn_to_non_running_unknown(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp) / "state"
            state_dir.mkdir()
            rollout = Path(tmp) / "rollout-session-1.jsonl"
            write_rollout(
                rollout,
                [
                    lifecycle("2026-07-17T00:00:00Z", "task_started", "turn-1"),
                    lifecycle("2026-07-17T00:02:00Z", "turn_aborted", "turn-1"),
                ],
            )
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "sessions": {
                            "session-1": {
                                "session_id": "session-1",
                                "status": "running",
                                "display_state": "running",
                                "display_state_started_at": "2026-07-17T00:00:00+00:00",
                                "last_seen_at": "2026-07-17T00:01:00+00:00",
                                "last_event_name": "PostToolUse",
                                "transcript_path": str(rollout),
                                "turn_id": "turn-1",
                                "current_tool": "",
                                "event_count": 2,
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            reconcile_sessions(state_dir)
            session = load_sessions(state_dir)["session-1"]

            self.assertEqual("unknown", session["status"])
            self.assertEqual("RolloutTurnAborted", session["last_event_name"])

    def test_reconcile_dry_run_is_idempotent_and_does_not_write(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp) / "state"
            state_dir.mkdir()
            rollout = Path(tmp) / "rollout-session-1.jsonl"
            write_rollout(rollout, [lifecycle("2026-07-17T00:02:00Z", "task_complete", "turn-1")])
            original = {
                "sessions": {
                    "session-1": {
                        "session_id": "session-1",
                        "status": "running",
                        "last_seen_at": "2026-07-17T00:01:00+00:00",
                        "transcript_path": str(rollout),
                        "event_count": 1,
                    }
                }
            }
            (state_dir / "sessions.json").write_text(json.dumps(original), encoding="utf-8")

            result = reconcile_sessions(state_dir, dry_run=True)

            self.assertEqual(1, result["updated_count"])
            self.assertEqual(original["sessions"], load_sessions(state_dir))
            self.assertFalse((state_dir / ".lock").exists())

    def test_reconcile_ignores_untrusted_or_older_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp) / "state"
            state_dir.mkdir()
            rollout = Path(tmp) / "rollout-different-session.jsonl"
            write_rollout(rollout, [lifecycle("2026-07-17T00:02:00Z", "task_complete", "turn-1")])
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "sessions": {
                            "session-1": {
                                "session_id": "session-1",
                                "status": "running",
                                "last_seen_at": "2026-07-17T00:03:00+00:00",
                                "transcript_path": str(rollout),
                                "event_count": 1,
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            result = reconcile_sessions(state_dir)

            self.assertEqual(0, result["examined_sessions"])
            self.assertEqual(0, result["updated_count"])

    def test_reconcile_resolves_exact_transcript_moved_to_archive(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_dir = root / "state"
            state_dir.mkdir()
            active = root / "codex-home" / "sessions" / "2026" / "07" / "17" / "rollout-session-1.jsonl"
            archived = root / "codex-home" / "archived_sessions" / active.name
            write_rollout(
                archived,
                [lifecycle("2026-07-17T00:02:00Z", "task_complete", "turn-1")],
            )
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "sessions": {
                            "session-1": {
                                "session_id": "session-1",
                                "status": "running",
                                "last_seen_at": "2026-07-17T00:01:00+00:00",
                                "transcript_path": str(active),
                                "event_count": 1,
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            result = reconcile_sessions(state_dir)

            self.assertEqual(1, result["updated_count"])
            self.assertEqual("done", load_sessions(state_dir)["session-1"]["status"])


if __name__ == "__main__":
    unittest.main()
