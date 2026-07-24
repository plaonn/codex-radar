#!/usr/bin/env python3
"""Compatibility entrypoint for the Mobile SSH Read Protocol Stage 0 spike."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable, Optional

from codex_radar.mobile_rpc import (
    ATTENTION_STATUSES,
    PROTOCOL,
    PROTOCOL_VERSION,
    RUNNING_STATUSES,
    SUPPORTED_PREVIEW_VERSIONS,
    ProtocolError,
    ReadProtocolSession,
    run_mobile_rpc,
    run_protocol,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the Stage 0-compatible read-only SSH protocol spike"
    )
    parser.add_argument("--state-dir")
    parser.add_argument("--codex-home")
    return parser


def main(argv: Optional[Iterable[str]] = None) -> int:
    args = _parser().parse_args(argv)
    state_dir = Path(args.state_dir).expanduser() if args.state_dir else None
    codex_home = Path(args.codex_home).expanduser() if args.codex_home else None
    return run_mobile_rpc(state_dir=state_dir, codex_home=codex_home)


if __name__ == "__main__":
    raise SystemExit(main())
