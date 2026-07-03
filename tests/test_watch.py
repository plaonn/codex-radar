import io
import json
import tempfile
import unittest
from pathlib import Path

from codex_radar.watch import (
    format_waiting_approval_alert,
    run_watch,
    waiting_approval_alerts,
)


class WatchTests(unittest.TestCase):
    def test_waiting_approval_alerts_only_reports_new_waiting_sessions(self) -> None:
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

    def test_format_waiting_approval_alert_uses_minimal_metadata(self) -> None:
        alert = format_waiting_approval_alert(
            {
                "session_id": "session-secret",
                "status": "waiting_approval",
                "project": "project-a",
                "last_event_name": "PermissionRequest",
                "cwd": "/private/path",
                "transcript_path": "/private/transcript.jsonl",
            }
        )

        self.assertEqual("codex-radar: waiting_approval project=project-a event=PermissionRequest", alert)
        self.assertNotIn("session-secret", alert)
        self.assertNotIn("/private", alert)

    def test_run_watch_once_prints_waiting_approval_alert(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "sessions": {
                            "session-1": {
                                "session_id": "session-1",
                                "status": "waiting_approval",
                                "project": "project-a",
                                "last_event_name": "PermissionRequest",
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
                "codex-radar: waiting_approval project=project-a event=PermissionRequest\n",
                out.getvalue(),
            )


if __name__ == "__main__":
    unittest.main()
