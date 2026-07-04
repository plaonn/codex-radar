import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from codex_radar.store import (
    CACHE_SCHEMA_VERSION,
    SESSION_CACHE_FIELDS,
    is_stale_session,
    load_sessions,
    normalize_event,
    record_hook_event,
    session_display_status,
)


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

    def test_normalize_event_accepts_camel_case_payload_aliases(self) -> None:
        event = normalize_event(
            {
                "hookEventName": "PreToolUse",
                "sessionId": "session-1",
                "turnId": "turn-1",
                "currentWorkingDirectory": "/tmp/example-project",
                "transcriptPath": "/tmp/transcript.jsonl",
                "modelName": "gpt-test",
                "permissionMode": "default",
                "toolInput": {"name": "Bash"},
                "lastAssistantMessage": "running command",
            },
            recorded_at="2026-07-03T00:00:00+00:00",
        )

        self.assertEqual("PreToolUse", event["event_name"])
        self.assertEqual("tool_running", event["status"])
        self.assertEqual("session-1", event["session_id"])
        self.assertEqual("turn-1", event["turn_id"])
        self.assertEqual("/tmp/example-project", event["cwd"])
        self.assertEqual("example-project", event["project"])
        self.assertEqual("/tmp/transcript.jsonl", event["transcript_path"])
        self.assertEqual("gpt-test", event["model"])
        self.assertEqual("default", event["permission_mode"])
        self.assertEqual("Bash", event["tool_name"])
        self.assertEqual("running command", event["last_assistant_message"])

    def test_normalize_event_maps_approval_policy_to_permission_mode(self) -> None:
        event = normalize_event(
            {
                "hook_event_name": "PermissionRequest",
                "session_id": "session-1",
                "approval_policy": "on-request",
            },
            recorded_at="2026-07-03T00:00:00+00:00",
        )

        self.assertEqual("waiting_approval", event["status"])
        self.assertEqual("on-request", event["permission_mode"])

    def test_normalize_event_extracts_name_from_nested_tool_input(self) -> None:
        event = normalize_event(
            {
                "hook_event_name": "PreToolUse",
                "session_id": "session-1",
                "tool_input": {"name": "Bash"},
            },
            recorded_at="2026-07-03T00:00:00+00:00",
        )

        self.assertEqual("tool_running", event["status"])
        self.assertEqual("Bash", event["tool_name"])

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

    def test_session_cache_writes_gui_read_contract_schema_v1(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            record_hook_event(
                {
                    "hook_event_name": "UserPromptSubmit",
                    "session_id": "session-1",
                    "turn_id": "turn-1",
                    "cwd": "/tmp/project-a",
                    "transcript_path": "/tmp/transcript.jsonl",
                    "model": "gpt-test",
                    "permission_mode": "default",
                    "last_assistant_message": "working",
                },
                state_dir,
            )

            payload = json.loads((state_dir / "sessions.json").read_text(encoding="utf-8"))
            self.assertEqual(CACHE_SCHEMA_VERSION, payload["schema_version"])
            self.assertIsInstance(payload["updated_at"], str)
            self.assertEqual(["session-1"], list(payload["sessions"]))
            session = payload["sessions"]["session-1"]
            self.assertEqual(set(SESSION_CACHE_FIELDS), set(session))

    def test_load_sessions_does_not_create_missing_state_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp) / "missing-state"

            self.assertEqual({}, load_sessions(state_dir))
            self.assertFalse(state_dir.exists())

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

    def test_subagent_start_and_stop_update_status_and_current_tool(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            started = record_hook_event(
                {
                    "hook_event_name": "SubagentStart",
                    "session_id": "session-1",
                    "cwd": "/tmp/project-a",
                    "tool_input": {"name": "Task"},
                },
                state_dir,
            )
            stopped = record_hook_event(
                {
                    "hook_event_name": "SubagentStop",
                    "session_id": "session-1",
                    "cwd": "/tmp/project-a",
                },
                state_dir,
            )

            self.assertEqual("running", started["status"])
            self.assertEqual("Task", started["current_tool"])
            self.assertEqual("done", stopped["status"])
            self.assertEqual("", stopped["current_tool"])

    def test_session_display_status_marks_old_running_session_stale(self) -> None:
        session = {
            "status": "running",
            "last_seen_at": "2026-07-03T00:00:00+00:00",
        }
        now = datetime(2026, 7, 3, 0, 31, tzinfo=timezone.utc)

        self.assertTrue(is_stale_session(session, now=now))
        self.assertEqual("stale", session_display_status(session, now=now))

    def test_session_display_status_keeps_done_and_approval_statuses(self) -> None:
        now = datetime(2026, 7, 3, 0, 31, tzinfo=timezone.utc)

        self.assertEqual(
            "done",
            session_display_status(
                {"status": "done", "last_seen_at": "2026-07-03T00:00:00+00:00"},
                now=now,
            ),
        )
        self.assertEqual(
            "waiting_approval",
            session_display_status(
                {"status": "waiting_approval", "last_seen_at": "2026-07-03T00:00:00+00:00"},
                now=now,
            ),
        )


if __name__ == "__main__":
    unittest.main()
