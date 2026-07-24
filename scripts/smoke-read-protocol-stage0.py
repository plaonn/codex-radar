#!/usr/bin/env python3
"""Disposable subprocess loopback smoke for the Stage 0 read protocol."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = ROOT / "scripts" / "read-protocol-stage0.py"


def _request(process: subprocess.Popen[str], payload: dict) -> dict:
    assert process.stdin is not None
    assert process.stdout is not None
    process.stdin.write(json.dumps(payload, separators=(",", ":")) + "\n")
    process.stdin.flush()
    line = process.stdout.readline()
    if not line:
        raise RuntimeError("protocol_eof")
    return json.loads(line)


def _start(state_dir: Path, codex_home: Path) -> subprocess.Popen[str]:
    environment = os.environ.copy()
    source_path = str(ROOT / "src")
    environment["PYTHONPATH"] = (
        source_path
        if not environment.get("PYTHONPATH")
        else source_path + os.pathsep + environment["PYTHONPATH"]
    )
    return subprocess.Popen(
        [
            sys.executable,
            str(PROTOCOL),
            "--state-dir",
            str(state_dir),
            "--codex-home",
            str(codex_home),
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=environment,
    )


def _exercise(process: subprocess.Popen[str]) -> None:
    initialized = _request(
        process,
        {
            "id": 1,
            "method": "initialize",
            "params": {
                "protocol_versions": [1],
                "preview_contract_versions": [2],
            },
        },
    )
    state = _request(process, {"id": 2, "method": "state/read"})
    preview = _request(
        process,
        {
            "id": 3,
            "method": "preview/read",
            "params": {"session_id": "session-1", "limit": 10},
        },
    )
    shutdown = _request(process, {"id": 4, "method": "shutdown"})
    if initialized["result"]["version"] != 1:
        raise RuntimeError("negotiation_failed")
    if state["result"]["contract"] != "codex-radar.display-state":
        raise RuntimeError("state_contract_failed")
    if preview["result"]["contract"] != "codex-radar.transcript-preview":
        raise RuntimeError("preview_contract_failed")
    if shutdown["result"] != {"shutdown": True}:
        raise RuntimeError("shutdown_failed")
    assert process.stdin is not None
    process.stdin.close()
    if process.wait(timeout=10) != 0:
        raise RuntimeError("protocol_exit_failed")
    assert process.stderr is not None
    if process.stderr.read():
        raise RuntimeError("stderr_not_empty")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="codex-radar-read-protocol-") as tmp:
        base = Path(tmp)
        state_dir = base / "state"
        codex_home = base / "codex-home"
        transcript = codex_home / "sessions" / "rollout-session-1.jsonl"
        state_dir.mkdir()
        transcript.parent.mkdir(parents=True)
        transcript.write_text(
            json.dumps(
                {
                    "type": "response_item",
                    "payload": {
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": "safe preview"}],
                    },
                }
            )
            + "\n",
            encoding="utf-8",
        )
        (state_dir / "sessions.json").write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "sessions": {
                        "session-1": {
                            "session_id": "session-1",
                            "project": "radar",
                            "status": "done",
                            "transcript_path": str(transcript),
                        }
                    },
                }
            ),
            encoding="utf-8",
        )

        _exercise(_start(state_dir, codex_home))
        _exercise(_start(state_dir, codex_home))
    print("read protocol Stage 0 loopback: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
