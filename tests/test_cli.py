import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
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


if __name__ == "__main__":
    unittest.main()
