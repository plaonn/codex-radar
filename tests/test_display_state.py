import json
import tempfile
import unittest
from unittest import mock
from datetime import datetime, timezone
from pathlib import Path

from codex_radar.display_state import (
    DISPLAY_STATE_CONTRACT,
    DISPLAY_STATE_VERSION,
    build_display_state,
    semantic_usage,
)


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = ROOT / "tests" / "fixtures" / "display-state-v1.json"


class DisplayStateTests(unittest.TestCase):
    def test_build_display_state_matches_golden_contract(self) -> None:
        sessions = {
            "waiting-1": {
                "session_id": "waiting-1",
                "project": "radar",
                "status": "waiting_approval",
                "first_seen_at": "2026-07-14T00:00:00+00:00",
                "last_seen_at": "2026-07-14T00:06:00+00:00",
                "display_state_started_at": "2026-07-14T00:06:00+00:00",
                "model": "gpt-test",
                "event_count": 5,
                "cwd": "/private/work/radar",
                "transcript_path": "/private/transcript.jsonl",
                "last_assistant_message": "private content",
                "permission_mode": "secret-mode",
                "turn_id": "private-turn",
            },
            "running-1": {
                "session_id": "running-1",
                "project": "radar",
                "status": "tool_running",
                "first_seen_at": "2026-07-14T00:00:00+00:00",
                "last_seen_at": "2026-07-14T00:05:00+00:00",
                "display_state_started_at": "2026-07-14T00:00:00+00:00",
                "model": "gpt-test",
                "current_tool": "Bash",
                "event_count": 4,
            },
            "archived-1": {
                "session_id": "archived-1",
                "project": "radar",
                "status": "done",
                "first_seen_at": "2026-07-13T00:00:00+00:00",
                "last_seen_at": "2026-07-13T01:00:00+00:00",
                "display_state_started_at": "2026-07-13T01:00:00+00:00",
                "model": "gpt-test",
                "event_count": 2,
            },
        }
        usage = {
            "available": True,
            "observed_at": "2026-07-14T00:00:00+00:00",
            "plan_type": "pro",
            "primary": {
                "window_minutes": 10080,
                "used_percent": 28,
                "remaining_percent": 72,
                "resets_at_iso": "2026-07-20T00:00:00+00:00",
            },
            "secondary": None,
        }

        result = build_display_state(
            sessions,
            usage=usage,
            archive_states={"waiting-1": "active", "running-1": "unknown", "archived-1": "archived"},
            capabilities=["usage", "transcript-preview", "archive-state"],
            generated_at="2026-07-14T00:00:00+00:00",
            now=datetime(2026, 7, 14, 0, 10, tzinfo=timezone.utc),
        )

        expected = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        self.assertEqual(expected, result)
        self.assertEqual(DISPLAY_STATE_CONTRACT, result["contract"])
        self.assertEqual(DISPLAY_STATE_VERSION, result["version"])

    def test_display_state_excludes_private_and_client_local_fields(self) -> None:
        marker = "/private/user/repo/transcript.jsonl"
        result = build_display_state(
            {
                "session-1": {
                    "session_id": "session-1",
                    "project": "/private/user/repo",
                    "status": "done",
                    "cwd": "/private/user/repo",
                    "transcript_path": marker,
                    "rollout_path": "/private/rollout.jsonl",
                    "state_db_path": "/private/state_5.sqlite",
                    "raw": {"content": marker},
                    "last_assistant_message": marker,
                    "html": f"<p>{marker}</p>",
                    "is_read": True,
                    "unread": False,
                }
            },
            source_status="unavailable",
            source_reason=marker,
            capabilities=["usage", marker],
            generated_at="2026-07-14T00:00:00+00:00",
        )

        encoded = json.dumps(result)
        for forbidden in (
            marker,
            "/private/user/repo",
            "transcript_path",
            "rollout_path",
            "state_db_path",
            "last_assistant_message",
            "html",
            "is_read",
            "unread",
            "private content",
        ):
            self.assertNotIn(forbidden, encoded)
        self.assertNotIn("project", result["sessions"][0])
        self.assertEqual({"status": "unavailable"}, result["source"])
        self.assertEqual(["usage"], result["capabilities"])

    def test_display_state_classifies_codex_memory_work_as_internal(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(
            "os.environ",
            {"CODEX_HOME": str(Path(tmp) / "codex-home")},
        ):
            result = build_display_state(
                {
                    "internal": {
                        "session_id": "internal",
                        "cwd": str(Path(tmp) / "codex-home" / "memories"),
                        "project": "memories",
                        "status": "done",
                    }
                },
                generated_at="2026-07-20T00:00:00+00:00",
            )

        self.assertEqual("Codex internal", result["sessions"][0]["project"])

    def test_display_state_fails_closed_on_identity_and_allowed_field_smuggling(self) -> None:
        marker = "/private/smuggled/value"
        result = build_display_state(
            {
                marker: {"status": "running"},
                "bad-explicit": {"session_id": "<b>identity</b>", "status": "done"},
                "safe-1": {
                    "session_id": "safe-1",
                    "project": marker,
                    "model": f"<img src='{marker}'>",
                    "current_tool": marker,
                    "status": "tool_running",
                    "first_seen_at": marker,
                    "last_seen_at": "not-a-date",
                    "display_state_started_at": "2026-07-14T00:00:00",
                },
            },
            usage={
                "available": True,
                "observed_at": marker,
                "plan_type": marker,
                "primary": {
                    "window_minutes": 300,
                    "remaining_percent": 50,
                    "resets_at_iso": marker,
                },
            },
            generated_at=marker,
        )

        self.assertEqual(["safe-1"], [item["session_id"] for item in result["sessions"]])
        session = result["sessions"][0]
        for field in (
            "project",
            "model",
            "current_tool",
            "first_seen_at",
            "last_seen_at",
            "display_state_started_at",
        ):
            self.assertNotIn(field, session)
        self.assertNotIn("observed_at", result["usage"])
        self.assertNotIn("plan_type", result["usage"])
        self.assertNotIn("resets_at_iso", result["usage"]["pools"]["five_hour"])
        self.assertNotIn(marker, json.dumps(result))
        generated = datetime.fromisoformat(result["generated_at"])
        self.assertIsNotNone(generated.tzinfo)

    def test_archive_counts_preserve_tri_state_partition(self) -> None:
        result = build_display_state(
            {
                "active-1": {"session_id": "active-1", "status": "done"},
                "archived-1": {"session_id": "archived-1", "status": "done"},
                "unknown-1": {"session_id": "unknown-1", "status": "done"},
            },
            archive_states={"active-1": "active", "archived-1": "archived"},
            generated_at="2026-07-14T00:00:00+00:00",
        )

        self.assertEqual(3, result["counts"]["total"])
        self.assertEqual(2, result["counts"]["visible"])
        self.assertEqual(1, result["counts"]["active"])
        self.assertEqual(1, result["counts"]["archived"])
        self.assertEqual(1, result["counts"]["archive_unknown"])

    def test_stale_running_session_does_not_count_as_running(self) -> None:
        result = build_display_state(
            {
                "stale-1": {
                    "session_id": "stale-1",
                    "status": "running",
                    "last_seen_at": "2026-07-14T00:00:00+00:00",
                }
            },
            archive_states={"stale-1": "active"},
            generated_at="2026-07-14T01:00:00+00:00",
            now=datetime(2026, 7, 14, 1, 0, tzinfo=timezone.utc),
        )

        self.assertEqual("stale", result["sessions"][0]["display_status"])
        self.assertEqual(0, result["counts"]["running"])

    def test_semantic_usage_keeps_lone_seven_day_pool_in_seven_day_slot(self) -> None:
        result = semantic_usage(
            {
                "available": True,
                "primary": {"window_minutes": 10080, "used_percent": 24},
                "secondary": None,
            }
        )

        self.assertIsNone(result["pools"]["five_hour"])
        self.assertEqual(10080, result["pools"]["seven_day"]["window_minutes"])
        self.assertEqual(76, result["pools"]["seven_day"]["remaining_percent"])

    def test_builder_does_not_write_to_working_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            before = list(directory.iterdir())
            build_display_state({}, generated_at="2026-07-14T00:00:00+00:00")
            after = list(directory.iterdir())

        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
