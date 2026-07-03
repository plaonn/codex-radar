import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path

from codex_radar.cli import main


class CliTests(unittest.TestCase):
    def test_sessions_prints_display_status_and_filters_stale(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "sessions": {
                            "old-running": {
                                "session_id": "old-running",
                                "status": "running",
                                "project": "project-a",
                                "last_seen_at": "2000-01-01T00:00:00+00:00",
                            },
                            "done": {
                                "session_id": "done",
                                "status": "done",
                                "project": "project-b",
                                "last_seen_at": "2026-07-03T00:00:00+00:00",
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )

            out = io.StringIO()
            with redirect_stdout(out):
                main(["--state-dir", str(state_dir), "sessions", "--status", "stale"])

            output = out.getvalue()
            self.assertIn("stale", output)
            self.assertIn("old-running", output)
            self.assertNotIn("project-b", output)

    def test_sessions_json_includes_display_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "sessions": {
                            "session-1": {
                                "session_id": "session-1",
                                "status": "done",
                                "last_seen_at": "2026-07-03T00:00:00+00:00",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            out = io.StringIO()
            with redirect_stdout(out):
                main(["--state-dir", str(state_dir), "sessions", "--json"])

            payload = json.loads(out.getvalue())
            self.assertEqual("done", payload[0]["display_status"])

    def test_sessions_filters_by_model_and_recent_duration(self) -> None:
        now = datetime.now(timezone.utc).replace(microsecond=0)
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "sessions": {
                            "recent-target": {
                                "session_id": "recent-target",
                                "status": "done",
                                "model": "gpt-5",
                                "last_seen_at": (now - timedelta(hours=1)).isoformat(),
                            },
                            "old-target": {
                                "session_id": "old-target",
                                "status": "done",
                                "model": "gpt-5",
                                "last_seen_at": (now - timedelta(days=2)).isoformat(),
                            },
                            "recent-other-model": {
                                "session_id": "recent-other-model",
                                "status": "done",
                                "model": "gpt-4.1",
                                "last_seen_at": now.isoformat(),
                            },
                        }
                    }
                ),
                encoding="utf-8",
            )

            out = io.StringIO()
            with redirect_stdout(out):
                main(
                    [
                        "--state-dir",
                        str(state_dir),
                        "sessions",
                        "--json",
                        "--model",
                        "gpt-5",
                        "--since",
                        "12h",
                    ]
                )

            payload = json.loads(out.getvalue())
            self.assertEqual(["recent-target"], [row["session_id"] for row in payload])

    def test_sessions_since_accepts_iso_timestamp(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp)
            (state_dir / "sessions.json").write_text(
                json.dumps(
                    {
                        "sessions": {
                            "before": {
                                "session_id": "before",
                                "status": "done",
                                "last_seen_at": "2026-07-02T23:59:59+00:00",
                            },
                            "after": {
                                "session_id": "after",
                                "status": "done",
                                "last_seen_at": "2026-07-03T00:00:00+00:00",
                            },
                        }
                    }
                ),
                encoding="utf-8",
            )

            out = io.StringIO()
            with redirect_stdout(out):
                main(
                    [
                        "--state-dir",
                        str(state_dir),
                        "sessions",
                        "--json",
                        "--since",
                        "2026-07-03T00:00:00+00:00",
                    ]
                )

            payload = json.loads(out.getvalue())
            self.assertEqual(["after"], [row["session_id"] for row in payload])

    def test_watch_once_reports_waiting_approval(self) -> None:
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
            with redirect_stdout(out):
                main(["--state-dir", str(state_dir), "watch", "--once", "--no-bell"])

            self.assertEqual(
                "codex-radar: waiting_approval project=project-a event=PermissionRequest\n",
                out.getvalue(),
            )

    def test_completion_prints_shell_script(self) -> None:
        out = io.StringIO()
        with redirect_stdout(out):
            main(["completion", "fish"])

        output = out.getvalue()
        self.assertIn("complete -c codex-radar", output)
        self.assertIn("sessions tui", output)


if __name__ == "__main__":
    unittest.main()
