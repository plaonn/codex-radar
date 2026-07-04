import io
import json
import tempfile
import unittest
from pathlib import Path

from codex_radar.watch import (
    format_status_alert,
    format_watch_start,
    format_waiting_approval_alert,
    run_watch,
    watch_alerts,
    waiting_approval_alerts,
)


class WatchTests(unittest.TestCase):
    def test_watch_alerts_default_to_done_sessions(self) -> None:
        seen = {}
        sessions = [
            {
                "session_id": "needs-approval",
                "status": "waiting_approval",
                "project": "project-a",
                "last_event_name": "PermissionRequest",
                "last_seen_at": "2026-07-03T00:00:00+00:00",
            },
            {
                "session_id": "done",
                "status": "done",
                "project": "project-b",
                "last_seen_at": "2026-07-03T00:00:00+00:00",
            },
        ]

        first = watch_alerts(sessions, seen)
        second = watch_alerts(sessions, seen)

        self.assertEqual(["done"], [item["session_id"] for item in first])
        self.assertEqual([], second)

    def test_waiting_approval_alerts_can_be_requested(self) -> None:
        seen = {}
        sessions = [
            {
                "session_id": "needs-approval",
                "status": "waiting_approval",
                "project": "project-a",
                "last_event_name": "PermissionRequest",
                "last_seen_at": "2026-07-03T00:00:00+00:00",
            },
            {
                "session_id": "done",
                "status": "done",
                "project": "project-b",
                "last_seen_at": "2026-07-03T00:00:00+00:00",
            },
        ]

        first = waiting_approval_alerts(sessions, seen)
        second = waiting_approval_alerts(sessions, seen)

        self.assertEqual(["needs-approval"], [item["session_id"] for item in first])
        self.assertEqual([], second)

    def test_format_status_alert_uses_minimal_metadata(self) -> None:
        alert = format_status_alert(
            {
                "session_id": "session-secret",
                "status": "done",
                "project": "project-a",
                "last_event_name": "Stop",
                "cwd": "/private/path",
                "transcript_path": "/private/transcript.jsonl",
            }
        )

        self.assertEqual("codex-radar: done project=project-a event=Stop", alert)
        self.assertNotIn("session-secret", alert)
        self.assertNotIn("/private", alert)

    def test_format_waiting_approval_alert_remains_compatible(self) -> None:
        alert = format_waiting_approval_alert(
            {
                "status": "waiting_approval",
                "project": "project-a",
                "last_event_name": "PermissionRequest",
            }
        )

        self.assertEqual("codex-radar: waiting_approval project=project-a event=PermissionRequest", alert)

    def test_format_watch_start_reports_current_counts(self) -> None:
        sessions = [
            {"status": "done"},
            {"status": "running"},
            {"status": "waiting_approval"},
        ]

        self.assertEqual(
            "codex-radar: watching status=done,waiting_approval sessions=3 matching=2",
            format_watch_start(sessions, ("waiting_approval", "done")),
        )

    def test_run_watch_once_announces_without_realerting_existing_done(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "sessions": {
                            "session-1": {
                                "session_id": "session-1",
                                "status": "done",
                                "project": "project-a",
                                "last_event_name": "Stop",
                                "last_seen_at": "2026-07-03T00:00:00+00:00",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            out = io.StringIO()
            result = run_watch(state_dir, once=True, bell=False, out=out)

            self.assertEqual(0, result)
            self.assertEqual(
                "codex-radar: watching status=done sessions=1 matching=1\n",
                out.getvalue(),
            )

    def test_run_watch_once_can_include_existing_done(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "sessions": {
                            "session-1": {
                                "session_id": "session-1",
                                "status": "done",
                                "project": "project-a",
                                "last_event_name": "Stop",
                                "last_seen_at": "2026-07-03T00:00:00+00:00",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            out = io.StringIO()
            result = run_watch(
                state_dir,
                once=True,
                bell=False,
                include_existing=True,
                announce=False,
                out=out,
            )

            self.assertEqual(0, result)
            self.assertEqual(
                "codex-radar: done project=project-a event=Stop\n",
                out.getvalue(),
            )


if __name__ == "__main__":
    unittest.main()
