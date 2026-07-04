from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

from .completion import COMPLETIONS, completion_script
from .store import (
    default_state_dir,
    iter_sessions,
    load_sessions,
    parse_timestamp,
    record_hook_event,
    session_display_status,
    session_seen_since,
)
from .transcript import format_skim, skim_transcript
from .tui import run_tui
from .watch import run_watch

_SINCE_DURATION = re.compile(r"^(?P<amount>\d+)(?P<unit>[smhd])$")
_SINCE_UNITS = {
    "s": "seconds",
    "m": "minutes",
    "h": "hours",
    "d": "days",
}


def _state_dir_arg(value: Optional[str]) -> Optional[Path]:
    return Path(value).expanduser() if value else None


def _since_arg(value: str) -> datetime:
    text = value.strip()
    duration = _SINCE_DURATION.fullmatch(text)
    if duration:
        amount = int(duration.group("amount"))
        unit = _SINCE_UNITS[duration.group("unit")]
        return datetime.now(timezone.utc) - timedelta(**{unit: amount})

    parsed = parse_timestamp(text)
    if parsed is not None:
        return parsed

    raise argparse.ArgumentTypeError(
        "expected ISO-8601 timestamp or duration like 30m, 2h, or 7d"
    )


def _read_stdin_json() -> Dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        raise SystemExit("codex-radar hook expects one JSON payload on stdin")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid hook JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise SystemExit("hook JSON must be an object")
    return payload


def _project_name(session: Dict[str, Any]) -> str:
    return str(session.get("project") or "-")


def _group_rows_by_project(rows: Iterable[Dict[str, Any]]) -> list[tuple[str, list[Dict[str, Any]]]]:
    groups: dict[str, list[Dict[str, Any]]] = {}
    order: list[str] = []
    for row in rows:
        project = _project_name(row)
        if project not in groups:
            groups[project] = []
            order.append(project)
        groups[project].append(row)
    return [(project, groups[project]) for project in order]


def _print_session_row(row: Dict[str, Any], widths: tuple[int, int, int, int, int]) -> None:
    session_id = row.get("session_id", "")
    print(
        f"{_clip(session_display_status(row), widths[0]):<{widths[0]}} "
        f"{_clip(row.get('project', ''), widths[1]):<{widths[1]}} "
        f"{_clip(row.get('last_seen_at', ''), widths[2]):<{widths[2]}} "
        f"{_clip(row.get('model', ''), widths[3]):<{widths[3]}} "
        f"{_clip(session_id, widths[4])}"
    )


def _print_sessions(
    sessions: Iterable[Dict[str, Any]],
    *,
    as_json: bool = False,
    limit: int = 50,
    group_project: bool = False,
) -> int:
    rows = list(sessions)[:limit]
    if as_json:
        payload = [
            {**row, "display_status": session_display_status(row)}
            for row in rows
        ]
        print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
        return 0

    terminal_width = shutil.get_terminal_size((120, 24)).columns
    widths = (16, 24, 20, 14, max(24, terminal_width - 82))
    print(
        f"{'STATUS':<{widths[0]}} "
        f"{'PROJECT':<{widths[1]}} "
        f"{'LAST SEEN':<{widths[2]}} "
        f"{'MODEL':<{widths[3]}} "
        f"SESSION"
    )
    print("-" * min(terminal_width, sum(widths) + 4))
    if group_project:
        for project, group_rows in _group_rows_by_project(rows):
            print(f"Project: {project} ({len(group_rows)})")
            for row in group_rows:
                _print_session_row(row, widths)
    else:
        for row in rows:
            _print_session_row(row, widths)
    if not rows:
        print("No sessions indexed yet.")
    return 0


def _clip(value: object, width: int) -> str:
    text = "" if value is None else str(value)
    if len(text) <= width:
        return text
    return text[: max(0, width - 3)] + "..."


def cmd_hook(args: argparse.Namespace) -> int:
    payload = _read_stdin_json()
    session = record_hook_event(payload, _state_dir_arg(args.state_dir))
    if args.print_session:
        print(json.dumps(session, ensure_ascii=False, sort_keys=True))
    return 0


def cmd_sessions(args: argparse.Namespace) -> int:
    state_dir = _state_dir_arg(args.state_dir)
    sessions = iter_sessions(state_dir)
    if args.project:
        sessions = (item for item in sessions if item.get("project") == args.project)
    if args.model:
        sessions = (item for item in sessions if item.get("model") == args.model)
    if args.status:
        sessions = (item for item in sessions if session_display_status(item) == args.status)
    if args.since:
        sessions = (item for item in sessions if session_seen_since(item, args.since))
    return _print_sessions(
        sessions,
        as_json=args.json,
        limit=args.limit,
        group_project=args.group_project,
    )


def _resolve_transcript(target: str, state_dir: Optional[Path]) -> Path:
    path = Path(target).expanduser()
    if path.exists():
        return path
    sessions = load_sessions(state_dir)
    session = sessions.get(target)
    if not session:
        raise SystemExit(f"unknown session or transcript path: {target}")
    transcript_path = session.get("transcript_path")
    if not transcript_path:
        raise SystemExit(f"session has no transcript path: {target}")
    return Path(transcript_path).expanduser()


def cmd_transcript(args: argparse.Namespace) -> int:
    state_dir = _state_dir_arg(args.state_dir)
    path = _resolve_transcript(args.target, state_dir)
    entries = skim_transcript(path, limit=args.limit)
    print(format_skim(entries, width=shutil.get_terminal_size((120, 24)).columns))
    return 0


def cmd_tui(args: argparse.Namespace) -> int:
    return run_tui(
        _state_dir_arg(args.state_dir),
        refresh_seconds=args.refresh,
        project=args.project,
        status=args.status,
        model=args.model,
        since=args.since,
    )


def cmd_path(args: argparse.Namespace) -> int:
    print(_state_dir_arg(args.state_dir) or default_state_dir())
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    state_dir = _state_dir_arg(args.state_dir) or default_state_dir()
    print(f"state_dir: {state_dir}")
    print(f"state_dir_exists: {state_dir.exists()}")
    print(f"sessions: {len(load_sessions(state_dir))}")
    return 0


def cmd_watch(args: argparse.Namespace) -> int:
    return run_watch(
        _state_dir_arg(args.state_dir),
        interval_seconds=args.interval,
        once=args.once,
        bell=not args.no_bell,
        statuses=args.status or None,
        include_existing=args.include_existing,
        announce=not args.quiet_start,
    )


def cmd_completion(args: argparse.Namespace) -> int:
    print(completion_script(args.shell), end="")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="codex-radar")
    parser.add_argument("--state-dir", help="Override codex-radar state directory")
    subparsers = parser.add_subparsers(dest="command", required=True)

    hook = subparsers.add_parser("hook", help="Record one Codex hook JSON payload from stdin")
    hook.add_argument("--print-session", action="store_true", help="Print updated session JSON")
    hook.set_defaults(func=cmd_hook)

    sessions = subparsers.add_parser("sessions", help="List indexed sessions")
    sessions.add_argument("--json", action="store_true", help="Print JSON")
    sessions.add_argument("--limit", type=int, default=50)
    sessions.add_argument("--group-project", action="store_true", help="Group text output by project")
    sessions.add_argument("--project")
    sessions.add_argument("--model")
    sessions.add_argument("--status")
    sessions.add_argument(
        "--since",
        type=_since_arg,
        metavar="WHEN",
        help="Only show sessions last seen since an ISO-8601 timestamp or duration like 30m, 2h, 7d",
    )
    sessions.set_defaults(func=cmd_sessions)

    transcript = subparsers.add_parser("transcript", help="Skim a transcript by session id or path")
    transcript.add_argument("target")
    transcript.add_argument("--limit", type=int, default=30)
    transcript.set_defaults(func=cmd_transcript)

    tui = subparsers.add_parser("tui", help="Open the terminal session dashboard")
    tui.add_argument("--refresh", type=float, default=2.0)
    tui.add_argument("--project")
    tui.add_argument("--model")
    tui.add_argument("--status")
    tui.add_argument(
        "--since",
        type=_since_arg,
        metavar="WHEN",
        help="Only show sessions last seen since an ISO-8601 timestamp or duration like 30m, 2h, 7d",
    )
    tui.set_defaults(func=cmd_tui)

    path = subparsers.add_parser("path", help="Print the active state directory")
    path.set_defaults(func=cmd_path)

    doctor = subparsers.add_parser("doctor", help="Print a short local diagnostic")
    doctor.set_defaults(func=cmd_doctor)

    watch = subparsers.add_parser("watch", help="Watch for local session status changes")
    watch.add_argument("--interval", type=float, default=2.0)
    watch.add_argument("--once", action="store_true", help="Check once and exit")
    watch.add_argument("--no-bell", action="store_true", help="Print alerts without terminal bell")
    watch.add_argument(
        "--status",
        action="append",
        help="Display status to alert on. Repeat to watch multiple statuses. Defaults to done.",
    )
    watch.add_argument(
        "--include-existing",
        action="store_true",
        help="Alert for matching sessions that already exist when watch starts",
    )
    watch.add_argument(
        "--quiet-start",
        action="store_true",
        help="Do not print the startup watch summary line",
    )
    watch.set_defaults(func=cmd_watch)

    completion = subparsers.add_parser("completion", help="Print a shell completion script")
    completion.add_argument("shell", choices=sorted(COMPLETIONS))
    completion.set_defaults(func=cmd_completion)

    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
