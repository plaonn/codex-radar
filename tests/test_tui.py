import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from codex_radar.tui import (
    _filter_sessions,
    _is_resumable,
    _move_selection,
    _preview_lines,
    _resume_command,
    _session_window,
)


class TuiHelperTests(unittest.TestCase):
    def test_resume_command_requires_session_id(self) -> None:
        self.assertEqual(["codex", "resume", "session-1"], _resume_command({"session_id": "session-1"}))
        self.assertIsNone(_resume_command({"session_id": ""}))
        self.assertFalse(_is_resumable({"session_id": "unknown:2026-07-03T00:00:00+00:00"}))

    def test_selection_is_clamped(self) -> None:
        sessions = [{"session_id": "a"}, {"session_id": "b"}]

        self.assertEqual(0, _move_selection(0, -1, sessions))
        self.assertEqual(1, _move_selection(0, 1, sessions))
        self.assertEqual(1, _move_selection(1, 1, sessions))

    def test_session_window_keeps_selected_row_visible(self) -> None:
        sessions = [{"session_id": str(index)} for index in range(5)]

        first, visible = _session_window(sessions, selected=4, max_rows=3)

        self.assertEqual(2, first)
        self.assertEqual(["2", "3", "4"], [item["session_id"] for item in visible])

    def test_filter_sessions_matches_project_model_status_and_since(self) -> None:
        sessions = [
            {
                "session_id": "target",
                "project": "project-a",
                "model": "gpt-5",
                "status": "done",
                "last_seen_at": "2026-07-03T01:00:00+00:00",
            },
            {
                "session_id": "old",
                "project": "project-a",
                "model": "gpt-5",
                "status": "done",
                "last_seen_at": "2026-07-02T23:00:00+00:00",
            },
            {
                "session_id": "other-model",
                "project": "project-a",
                "model": "gpt-4.1",
                "status": "done",
                "last_seen_at": "2026-07-03T01:00:00+00:00",
            },
        ]

        visible = _filter_sessions(
            sessions,
            project="project-a",
            model="gpt-5",
            status="done",
            since=datetime(2026, 7, 3, 0, 0, tzinfo=timezone.utc),
        )

        self.assertEqual(["target"], [session["session_id"] for session in visible])

    def test_preview_lines_reads_and_redacts_transcript(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "transcript.jsonl"
            path.write_text(
                json.dumps({"role": "user", "content": [{"text": "token=supersecret"}]}) + "\n",
                encoding="utf-8",
            )

            lines = _preview_lines({"transcript_path": str(path)}, width=80)

            output = "\n".join(lines)
            self.assertIn("[REDACTED]", output)
            self.assertNotIn("supersecret", output)

    def test_preview_lines_reports_missing_path(self) -> None:
        self.assertEqual(["No transcript path recorded."], _preview_lines({}, width=80))


if __name__ == "__main__":
    unittest.main()
