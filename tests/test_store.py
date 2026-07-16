import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from codex_radar.store import (
    CACHE_SCHEMA_VERSION,
    DEFAULT_RETENTION_DAYS,
    SESSION_CACHE_FIELDS,
    is_stale_session,
    load_config,
    load_sessions,
    normalize_event,
    prune_sessions,
    record_hook_event,
    save_config,
    session_display_status,
    update_session_cache,
)


class StoreTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "native Windows locking test")
    def test_concurrent_windows_hook_updates_are_serialized(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            script = (
                "from pathlib import Path\n"
                "from codex_radar.store import record_hook_event\n"
                f"state = Path({tmp!r})\n"
                "for _ in range(20):\n"
                "    record_hook_event({'hook_event_name':'UserPromptSubmit','session_id':'shared'}, state)\n"
            )
            env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "src")}
            workers = [
                subprocess.Popen([sys.executable, "-c", script], env=env)
                for _ in range(2)
            ]
            for worker in workers:
                self.assertEqual(0, worker.wait(timeout=30))
            self.assertEqual(40, load_sessions(Path(tmp))["shared"]["event_count"])
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

    def test_record_hook_event_updates_cache_without_event_log(self) -> None:
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
            self.assertFalse((state_dir / "events.jsonl").exists())
            sessions = load_sessions(state_dir)
            self.assertEqual("running", sessions["session-1"]["status"])

    def test_record_hook_event_applies_retention_and_removes_legacy_event_log(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            (state_dir / "events.jsonl").write_text('{"legacy": true}\n', encoding="utf-8")
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "sessions": {
                            "old": {
                                "session_id": "old",
                                "status": "done",
                                "last_seen_at": "2000-01-01T00:00:00+00:00",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            record_hook_event(
                {
                    "hook_event_name": "Stop",
                    "session_id": "new",
                    "cwd": "/tmp/project-a",
                },
                state_dir,
            )

            self.assertFalse((state_dir / "events.jsonl").exists())
            self.assertEqual(["new"], sorted(load_sessions(state_dir)))

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

    def test_config_defaults_and_save(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp) / "missing-state"

            self.assertEqual(DEFAULT_RETENTION_DAYS, load_config(state_dir)["retention_days"])
            self.assertFalse(state_dir.exists())

            saved = save_config({"retention_days": 14}, state_dir)

            self.assertEqual(14, saved["retention_days"])
            self.assertEqual(14, load_config(state_dir)["retention_days"])

    def test_prune_sessions_removes_old_sessions_and_legacy_event_log(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            (state_dir / "events.jsonl").write_text('{"legacy": true}\n', encoding="utf-8")
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "sessions": {
                            "old": {
                                "session_id": "old",
                                "status": "done",
                                "last_seen_at": "2026-06-01T00:00:00+00:00",
                            },
                            "recent": {
                                "session_id": "recent",
                                "status": "done",
                                "last_seen_at": "2026-07-04T00:00:00+00:00",
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = prune_sessions(
                state_dir,
                retention_days=7,
                now=datetime(2026, 7, 5, tzinfo=timezone.utc),
            )

            self.assertEqual(["old"], result["removed_sessions"])
            self.assertTrue(result["legacy_events_removed"])
            self.assertFalse((state_dir / "events.jsonl").exists())
            self.assertEqual(["recent"], list(load_sessions(state_dir)))

    def test_prune_sessions_dry_run_does_not_modify_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            (state_dir / "events.jsonl").write_text('{"legacy": true}\n', encoding="utf-8")
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "sessions": {
                            "old": {
                                "session_id": "old",
                                "status": "done",
                                "last_seen_at": "2026-06-01T00:00:00+00:00",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            result = prune_sessions(
                state_dir,
                retention_days=7,
                now=datetime(2026, 7, 5, tzinfo=timezone.utc),
                dry_run=True,
            )

            self.assertEqual(["old"], result["removed_sessions"])
            self.assertTrue((state_dir / "events.jsonl").exists())
            self.assertEqual(["old"], list(load_sessions(state_dir)))

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

    def test_display_state_tracks_macro_state_without_tool_resets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            started = update_session_cache(
                normalize_event(
                    {
                        "hook_event_name": "UserPromptSubmit",
                        "session_id": "session-1",
                        "cwd": "/tmp/project-a",
                    },
                    recorded_at="2026-07-03T00:00:00+00:00",
                ),
                state_dir,
            )
            # Use normalized events directly so the test can control recorded_at.
            tool_started = update_session_cache(
                normalize_event(
                    {
                        "hook_event_name": "PreToolUse",
                        "session_id": "session-1",
                        "cwd": "/tmp/project-a",
                        "tool_name": "Bash",
                    },
                    recorded_at="2026-07-03T00:05:00+00:00",
                ),
                state_dir,
            )
            tool_finished = update_session_cache(
                normalize_event(
                    {
                        "hook_event_name": "PostToolUse",
                        "session_id": "session-1",
                        "cwd": "/tmp/project-a",
                    },
                    recorded_at="2026-07-03T00:06:00+00:00",
                ),
                state_dir,
            )
            waiting = update_session_cache(
                normalize_event(
                    {
                        "hook_event_name": "PermissionRequest",
                        "session_id": "session-1",
                        "cwd": "/tmp/project-a",
                    },
                    recorded_at="2026-07-03T00:07:00+00:00",
                ),
                state_dir,
            )

            self.assertEqual("running", started["display_state"])
            self.assertEqual(started["last_seen_at"], started["display_state_started_at"])
            self.assertEqual("tool_running", tool_started["status"])
            self.assertEqual("running", tool_started["display_state"])
            self.assertEqual(started["display_state_started_at"], tool_started["display_state_started_at"])
            self.assertEqual("running", tool_finished["display_state"])
            self.assertEqual(started["display_state_started_at"], tool_finished["display_state_started_at"])
            self.assertEqual("waiting_approval", waiting["display_state"])
            self.assertEqual("2026-07-03T00:07:00+00:00", waiting["display_state_started_at"])

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
