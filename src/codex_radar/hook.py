from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional, TextIO

from .store import record_hook_event


def read_hook_payload(stream: TextIO) -> Dict[str, Any]:
    raw = stream.read()
    if not raw.strip():
        raise SystemExit("codex-radar hook expects one JSON payload on stdin")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid hook JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise SystemExit("hook JSON must be an object")
    return payload


def run_hook(
    *,
    state_dir: Optional[Path] = None,
    print_session: bool = False,
    stream: Optional[TextIO] = None,
) -> int:
    payload = read_hook_payload(stream or sys.stdin)
    session = record_hook_event(payload, state_dir)
    if print_session:
        print(json.dumps(session, ensure_ascii=False, sort_keys=True))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="codex-radar-hook")
    parser.add_argument("--state-dir", help="Override codex-radar state directory")
    parser.add_argument("--print-session", action="store_true", help="Print updated session JSON")
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    state_dir = Path(args.state_dir).expanduser() if args.state_dir else None
    return run_hook(state_dir=state_dir, print_session=args.print_session)


if __name__ == "__main__":
    raise SystemExit(main())
