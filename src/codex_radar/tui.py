from __future__ import annotations

import curses
import time
from pathlib import Path
from typing import Optional

from .store import iter_sessions


def _trim(value: object, width: int) -> str:
    text = "" if value is None else str(value)
    if width <= 1:
        return text[:width]
    if len(text) <= width:
        return text
    return text[: max(0, width - 3)] + "..."


def _draw(stdscr: "curses._CursesWindow", state_dir: Optional[Path]) -> None:
    stdscr.erase()
    height, width = stdscr.getmaxyx()
    title = "codex-radar  q: quit  r: refresh"
    stdscr.addstr(0, 0, _trim(title, width - 1), curses.A_BOLD)
    headers = ("STATUS", "PROJECT", "LAST EVENT", "MODEL", "SESSION")
    columns = (16, 24, 18, 14, max(20, width - 77))
    header = (
        f"{headers[0]:<{columns[0]}} "
        f"{headers[1]:<{columns[1]}} "
        f"{headers[2]:<{columns[2]}} "
        f"{headers[3]:<{columns[3]}} "
        f"{headers[4]:<{columns[4]}}"
    )
    stdscr.addstr(2, 0, _trim(header, width - 1), curses.A_UNDERLINE)

    row = 3
    for session in iter_sessions(state_dir):
        if row >= height - 1:
            break
        line = (
            f"{_trim(session.get('status'), columns[0]):<{columns[0]}} "
            f"{_trim(session.get('project'), columns[1]):<{columns[1]}} "
            f"{_trim(session.get('last_event_name'), columns[2]):<{columns[2]}} "
            f"{_trim(session.get('model'), columns[3]):<{columns[3]}} "
            f"{_trim(session.get('session_id'), columns[4]):<{columns[4]}}"
        )
        attr = curses.A_NORMAL
        if session.get("status") == "waiting_approval":
            attr = curses.A_BOLD
        stdscr.addstr(row, 0, _trim(line, width - 1), attr)
        row += 1

    if row == 3:
        stdscr.addstr(4, 0, "No sessions indexed yet. Install hooks and run a Codex turn.")
    stdscr.refresh()


def run_tui(state_dir: Optional[Path] = None, refresh_seconds: float = 2.0) -> int:
    def loop(stdscr: "curses._CursesWindow") -> int:
        curses.curs_set(0)
        stdscr.nodelay(True)
        while True:
            _draw(stdscr, state_dir)
            deadline = time.monotonic() + refresh_seconds
            while time.monotonic() < deadline:
                key = stdscr.getch()
                if key in (ord("q"), ord("Q")):
                    return 0
                if key in (ord("r"), ord("R")):
                    break
                time.sleep(0.05)

    return curses.wrapper(loop)
