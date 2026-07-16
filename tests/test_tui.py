import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

if os.name == "nt":
    raise unittest.SkipTest("curses TUI is not available on native Windows")

from codex_radar.tui import (
    _draw,
    _filter_sessions,
    _group_sessions_by_project,
    _is_resumable,
    _move_selection,
    _preview_lines,
    _resume_command,
    _session_window,
    _session_view_rows,
    _view_window,
)


class FakeWindow:
    def __init__(self, height: int, width: int) -> None:
        self.height = height
        self.width = width
        self.calls = []

    def erase(self) -> None:
        self.calls.append(("erase",))

    def getmaxyx(self):
        return self.height, self.width

    def addstr(self, row, col, text, attr=0) -> None:
        if row < 0 or row >= self.height or col < 0 or col >= self.width:
            raise RuntimeError(f"out of bounds: {row},{col}")
        self.calls.append(("addstr", row, col, text, attr))

    def hline(self, row, col, ch, count) -> None:
        if row < 0 or row >= self.height or col < 0 or col >= self.width:
            raise RuntimeError(f"out of bounds: {row},{col}")
        self.calls.append(("hline", row, col, count))

    def refresh(self) -> None:
        self.calls.append(("refresh",))


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

    def test_group_sessions_by_project_preserves_recent_project_order(self) -> None:
        sessions = [
            {"session_id": "a1", "project": "a"},
            {"session_id": "b1", "project": "b"},
            {"session_id": "a2", "project": "a"},
            {"session_id": "b2", "project": "b"},
        ]

        grouped = _group_sessions_by_project(sessions)

        self.assertEqual(["a1", "a2", "b1", "b2"], [session["session_id"] for session in grouped])

    def test_session_view_rows_adds_project_headers(self) -> None:
        sessions = [
            {"session_id": "a1", "project": "a"},
            {"session_id": "a2", "project": "a"},
            {"session_id": "b1", "project": "b"},
        ]

        rows = _session_view_rows(sessions)

        self.assertEqual(
            [
                ("group", "a", 2),
                ("session", "a1", None),
                ("session", "a2", None),
                ("group", "b", 1),
                ("session", "b1", None),
            ],
            [
                (
                    row["kind"],
                    row.get("project") or row.get("session", {}).get("session_id"),
                    row.get("count"),
                )
                for row in rows
            ],
        )

    def test_view_window_keeps_selected_session_visible_with_group_header(self) -> None:
        sessions = [
            {"session_id": "a1", "project": "a"},
            {"session_id": "a2", "project": "a"},
            {"session_id": "b1", "project": "b"},
        ]

        _, rows, selected_row = _view_window(sessions, selected=2, max_rows=3)

        self.assertEqual(["group", "session"], [row["kind"] for row in rows[-2:]])
        self.assertEqual("b", rows[-2]["project"])
        self.assertEqual("b1", rows[-1]["session"]["session_id"])
        self.assertEqual(2, selected_row)
        self.assertLess(selected_row, len(rows))

    def test_view_window_does_not_include_header_when_it_would_hide_selection(self) -> None:
        sessions = [
            {"session_id": "a1", "project": "a"},
            {"session_id": "b1", "project": "b"},
            {"session_id": "b2", "project": "b"},
            {"session_id": "b3", "project": "b"},
        ]

        _, rows, selected_row = _view_window(sessions, selected=3, max_rows=3)

        self.assertEqual("b3", rows[selected_row]["session"]["session_id"])
        self.assertLess(selected_row, len(rows))

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

    def test_draw_handles_very_small_empty_terminal(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            window = FakeWindow(height=3, width=20)

            sessions = _draw(window, Path(tmp), selected=0)

        self.assertEqual([], sessions)
        self.assertIn(("refresh",), window.calls)

    def test_draw_handles_tiny_width(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            window = FakeWindow(height=4, width=1)

            sessions = _draw(window, Path(tmp), selected=0)

        self.assertEqual([], sessions)
        self.assertIn(("refresh",), window.calls)


if __name__ == "__main__":
    unittest.main()
