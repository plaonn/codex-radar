import json
import tempfile
import unittest
from pathlib import Path

from codex_radar.store import load_sessions, normalize_event, record_hook_event


class StoreTests(unittest.TestCase):
    def test_normalize_event_derives_project_and_status(self) -> None:
        event = normalize_event(
            {
                "hook_event_name": "Stop",
                "session_id": "session-1",
                "cwd": "/tmp/example-project",
                "last_assistant_message": "done",
            },
            recorded_at="2026-07-03T00:00:00+00:00",
        )

        self.assertEqual("done", event["status"])
        self.assertEqual("example-project", event["project"])
        self.assertEqual("session-1", event["session_id"])

    def test_record_hook_event_appends_event_and_updates_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            session = record_hook_event(
                {
                    "hook_event_name": "UserPromptSubmit",
                    "session_id": "session-1",
                    "turn_id": "turn-1",
                    "cwd": "/tmp/project-a",
                    "transcript_path": "/tmp/transcript.jsonl",
                    "model": "gpt-test",
                    "permission_mode": "default",
                },
                state_dir,
            )

            self.assertEqual("running", session["status"])
            self.assertEqual("project-a", session["project"])
            events = (state_dir / "events.jsonl").read_text(encoding="utf-8").strip().splitlines()
            self.assertEqual(1, len(events))
            self.assertEqual("UserPromptSubmit", json.loads(events[0])["event_name"])
            sessions = load_sessions(state_dir)
            self.assertEqual("running", sessions["session-1"]["status"])

    def test_stop_clears_current_tool(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            record_hook_event(
                {
                    "hook_event_name": "PreToolUse",
                    "session_id": "session-1",
                    "cwd": "/tmp/project-a",
                    "tool_name": "Bash",
                },
                state_dir,
            )
            session = record_hook_event(
                {
                    "hook_event_name": "Stop",
                    "session_id": "session-1",
                    "cwd": "/tmp/project-a",
                },
                state_dir,
            )

            self.assertEqual("done", session["status"])
            self.assertEqual("", session["current_tool"])


if __name__ == "__main__":
    unittest.main()
