from __future__ import annotations

import curses
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from .store import iter_sessions
from .transcript import format_skim, skim_transcript


Session = Dict[str, Any]


def _trim(value: object, width: int) -> str:
    text = "" if value is None else str(value)
    if width <= 1:
        return text[:width]
    if len(text) <= width:
        return text
    return text[: max(0, width - 3)] + "..."


def _visible_sessions(state_dir: Optional[Path]) -> List[Session]:
    return list(iter_sessions(state_dir))


def _selected_index(current: int, sessions: Sequence[Session]) -> int:
    if not sessions:
        return 0
    return min(max(current, 0), len(sessions) - 1)


def _move_selection(current: int, delta: int, sessions: Sequence[Session]) -> int:
    return _selected_index(current + delta, sessions)


def _session_window(sessions: Sequence[Session], selected: int, max_rows: int) -> tuple[int, Sequence[Session]]:
    if max_rows <= 0 or not sessions:
        return 0, []
    selected = _selected_index(selected, sessions)
    if len(sessions) <= max_rows:
        return 0, sessions
    start = min(max(0, selected - max_rows + 1), len(sessions) - max_rows)
    return start, sessions[start : start + max_rows]


def _resume_id(session: Session) -> str:
    session_id = str(session.get("session_id") or "")
    if not session_id or session_id.startswith("unknown:"):
        return ""
    return session_id


def _is_resumable(session: Session) -> bool:
    return bool(_resume_id(session))


def _resume_command(session: Session) -> Optional[List[str]]:
    session_id = _resume_id(session)
    if not session_id:
        return None
    return ["codex", "resume", session_id]


def _preview_lines(session: Session, *, width: int, limit: int = 8) -> List[str]:
    transcript_path = str(session.get("transcript_path") or "")
    if not transcript_path:
        return ["No transcript path recorded."]

    path = Path(transcript_path).expanduser()
    try:
        entries = skim_transcript(path, limit=limit)
    except FileNotFoundError:
        return ["Transcript file not found."]
    except OSError as exc:
        return [f"Could not read transcript: {exc.strerror or exc.__class__.__name__}"]

    if not entries:
        return ["No previewable transcript text found."]
    return format_skim(entries, width=width).splitlines()


def _status_attr(session: Session) -> int:
    attr = curses.A_NORMAL
    if session.get("status") == "waiting_approval":
        attr |= curses.A_BOLD
    if not _is_resumable(session):
        attr |= curses.A_DIM
    return attr


def _draw_rows(
    stdscr: "curses._CursesWindow",
    sessions: Sequence[Session],
    selected: int,
    *,
    start_row: int,
    max_rows: int,
    width: int,
) -> None:
    headers = ("STATUS", "PROJECT", "LAST EVENT", "MODEL", "SESSION")
    columns = (16, 24, 18, 14, max(20, width - 77))
    header = (
        f"{headers[0]:<{columns[0]}} "
        f"{headers[1]:<{columns[1]}} "
        f"{headers[2]:<{columns[2]}} "
        f"{headers[3]:<{columns[3]}} "
        f"{headers[4]:<{columns[4]}}"
    )
    stdscr.addstr(start_row, 0, _trim(header, width - 1), curses.A_UNDERLINE)

    for offset, session in enumerate(sessions[:max_rows]):
        row = start_row + 1 + offset
        marker = " " if _is_resumable(session) else "-"
        line = (
            f"{marker} "
            f"{_trim(session.get('status'), columns[0] - 2):<{columns[0] - 2}} "
            f"{_trim(session.get('project'), columns[1]):<{columns[1]}} "
            f"{_trim(session.get('last_event_name'), columns[2]):<{columns[2]}} "
            f"{_trim(session.get('model'), columns[3]):<{columns[3]}} "
            f"{_trim(session.get('session_id'), columns[4]):<{columns[4]}}"
        )
        attr = _status_attr(session)
        if offset == selected:
            attr |= curses.A_REVERSE
        stdscr.addstr(row, 0, _trim(line, width - 1), attr)


def _draw_detail(
    stdscr: "curses._CursesWindow",
    session: Session,
    *,
    start_row: int,
    height: int,
    width: int,
) -> None:
    lines = [
        (
            f"Selected: {session.get('project') or '-'}  "
            f"{session.get('status') or '-'}  "
            f"{session.get('model') or '-'}"
        ),
        f"CWD: {session.get('cwd') or '-'}",
    ]
    command = _resume_command(session)
    if command:
        lines.append(f"Enter: {' '.join(command)}")
    else:
        lines.append("Enter: unavailable for this row")

    assistant = str(session.get("last_assistant_message") or "")
    if assistant:
        lines.append(f"Latest assistant: {assistant}")

    lines.append("Preview:")
    lines.extend(_preview_lines(session, width=width))

    for offset, line in enumerate(lines[: max(0, height - start_row - 1)]):
        stdscr.addstr(start_row + offset, 0, _trim(line, width - 1))


def _draw(
    stdscr: "curses._CursesWindow",
    state_dir: Optional[Path],
    selected: int,
) -> List[Session]:
    stdscr.erase()
    height, width = stdscr.getmaxyx()
    title = "codex-radar  up/down: select  enter: resume  r: refresh  q: quit"
    stdscr.addstr(0, 0, _trim(title, width - 1), curses.A_BOLD)

    sessions = _visible_sessions(state_dir)
    selected = _selected_index(selected, sessions)
    list_rows = max(1, min(len(sessions), max(1, height // 2 - 3)))
    first_visible, visible_sessions = _session_window(sessions, selected, list_rows)
    _draw_rows(
        stdscr,
        visible_sessions,
        selected - first_visible,
        start_row=2,
        max_rows=list_rows,
        width=width,
    )

    if not sessions:
        stdscr.addstr(4, 0, "No sessions indexed yet. Install hooks and run a Codex turn.")
    else:
        detail_row = 2 + list_rows + 2
        if detail_row < height - 1:
            stdscr.hline(detail_row - 1, 0, curses.ACS_HLINE, max(1, width - 1))
            _draw_detail(stdscr, sessions[selected], start_row=detail_row, height=height, width=width)

    stdscr.refresh()
    return sessions


def run_tui(state_dir: Optional[Path] = None, refresh_seconds: float = 2.0) -> int:
    def loop(stdscr: "curses._CursesWindow") -> Optional[List[str]]:
        curses.curs_set(0)
        stdscr.nodelay(True)
        selected = 0
        sessions: List[Session] = []
        while True:
            selected = _selected_index(selected, sessions)
            sessions = _draw(stdscr, state_dir, selected)
            selected = _selected_index(selected, sessions)
            deadline = time.monotonic() + refresh_seconds
            while time.monotonic() < deadline:
                key = stdscr.getch()
                if key in (ord("q"), ord("Q")):
                    return None
                if key in (ord("r"), ord("R")):
                    break
                if key in (curses.KEY_UP, ord("k"), ord("K")):
                    selected = _move_selection(selected, -1, sessions)
                    break
                if key in (curses.KEY_DOWN, ord("j"), ord("J")):
                    selected = _move_selection(selected, 1, sessions)
                    break
                if key in (10, 13, curses.KEY_ENTER) and sessions:
                    command = _resume_command(sessions[selected])
                    if command:
                        return command
                    break
                time.sleep(0.05)

    command = curses.wrapper(loop)
    if not command:
        return 0
    try:
        os.execvp(command[0], command)
    except FileNotFoundError:
        print(f"codex-radar: command not found: {command[0]}", file=sys.stderr)
        return 127
    except OSError as exc:
        print(f"codex-radar: failed to run {' '.join(command)}: {exc}", file=sys.stderr)
        return 1
