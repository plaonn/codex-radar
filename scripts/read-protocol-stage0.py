#!/usr/bin/env python3
"""Foreground read-only JSONL protocol spike for Mobile SSH Stage 0."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Mapping, Optional, TextIO

from codex_radar.export_adapter import (
    ExportAdapterError,
    export_display_state,
    export_transcript_preview,
)
from codex_radar.transcript_preview import MAX_PREVIEW_LIMIT


PROTOCOL = "codex-radar.read-protocol"
PROTOCOL_VERSION = 1
SUPPORTED_PREVIEW_VERSIONS = (1, 2)
ATTENTION_STATUSES = {"waiting_approval"}
RUNNING_STATUSES = {"running", "tool_running"}


class ProtocolError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _version_list(value: Any) -> list[int]:
    if not isinstance(value, list):
        raise ProtocolError("invalid_versions")
    versions = [item for item in value if type(item) is int and item > 0]
    if len(versions) != len(value) or not versions:
        raise ProtocolError("invalid_versions")
    return versions


def _request_id(value: Any) -> str | int:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ProtocolError("invalid_request_id")
    return value


def _response(request_id: str | int, result: Mapping[str, Any]) -> Dict[str, Any]:
    return {"id": request_id, "result": dict(result)}


def _error(request_id: Any, code: str) -> Dict[str, Any]:
    safe_id = request_id if isinstance(request_id, (str, int)) and not isinstance(request_id, bool) else None
    return {"id": safe_id, "error": {"code": code}}


class ReadProtocolSession:
    def __init__(
        self,
        *,
        state_reader: Callable[[], Dict[str, Any]],
        preview_reader: Callable[[str, int, int], Dict[str, Any]],
    ) -> None:
        self._state_reader = state_reader
        self._preview_reader = preview_reader
        self._initialized = False
        self._preview_version = 0
        self._attention_baseline: Dict[str, str] = {}
        self._attention_started = False
        self._event_sequence = 0

    def _read_state(self) -> Dict[str, Any]:
        state = self._state_reader()
        if (
            not isinstance(state, dict)
            or state.get("contract") != "codex-radar.display-state"
            or state.get("version") != 1
            or not isinstance(state.get("sessions"), list)
        ):
            raise ProtocolError("display_state_contract_invalid")
        return state

    def _attention_events(self, state: Mapping[str, Any]) -> list[Dict[str, Any]]:
        current: Dict[str, str] = {}
        sessions: Dict[str, Mapping[str, Any]] = {}
        for value in state["sessions"]:
            if not isinstance(value, Mapping):
                raise ProtocolError("display_state_contract_invalid")
            session_id = value.get("session_id")
            status = value.get("display_status", value.get("status"))
            if not isinstance(session_id, str) or not isinstance(status, str):
                raise ProtocolError("display_state_contract_invalid")
            current[session_id] = status
            sessions[session_id] = value

        events: list[Dict[str, Any]] = []
        if self._attention_started:
            for session_id, status in current.items():
                previous = self._attention_baseline.get(session_id)
                eligible = (
                    status in ATTENTION_STATUSES and previous != status
                ) or (
                    status == "done"
                    and previous in RUNNING_STATUSES
                )
                if not eligible:
                    continue
                self._event_sequence += 1
                session = sessions[session_id]
                events.append(
                    {
                        "event": "attention",
                        "params": {
                            "sequence": self._event_sequence,
                            "session_id": session_id,
                            "project": str(session.get("project") or "-"),
                            "status": status,
                            "previous_status": previous or "unknown",
                        },
                    }
                )
        self._attention_baseline = current
        self._attention_started = True
        return events

    def handle(self, request: Any) -> tuple[list[Dict[str, Any]], bool]:
        if not isinstance(request, dict):
            raise ProtocolError("invalid_request")
        request_id = _request_id(request.get("id"))
        method = request.get("method")
        params = request.get("params", {})
        if not isinstance(method, str) or not isinstance(params, dict):
            raise ProtocolError("invalid_request")

        if method == "initialize":
            protocol_versions = _version_list(params.get("protocol_versions"))
            preview_versions = _version_list(params.get("preview_contract_versions"))
            if PROTOCOL_VERSION not in protocol_versions:
                raise ProtocolError("unsupported_protocol_version")
            mutual = sorted(set(preview_versions).intersection(SUPPORTED_PREVIEW_VERSIONS))
            if not mutual:
                raise ProtocolError("unsupported_preview_version")
            self._initialized = True
            self._preview_version = mutual[-1]
            self._attention_baseline = {}
            self._attention_started = False
            return [
                _response(
                    request_id,
                    {
                        "protocol": PROTOCOL,
                        "version": PROTOCOL_VERSION,
                        "display_state_version": 1,
                        "preview_contract_version": self._preview_version,
                        "capabilities": [
                            "state/read",
                            "preview/read",
                            "attention/poll",
                        ],
                        "attention_delivery": "foreground-poll",
                    },
                )
            ], False

        if not self._initialized:
            raise ProtocolError("not_initialized")

        if method == "state/read":
            return [_response(request_id, self._read_state())], False

        if method == "preview/read":
            session_id = params.get("session_id")
            limit = params.get("limit")
            version = params.get("contract_version", self._preview_version)
            if not isinstance(session_id, str) or not session_id:
                raise ProtocolError("invalid_session_id")
            if type(limit) is not int or not 1 <= limit <= MAX_PREVIEW_LIMIT:
                raise ProtocolError("invalid_preview_limit")
            if version != self._preview_version:
                raise ProtocolError("preview_version_not_negotiated")
            try:
                preview = self._preview_reader(session_id, limit, version)
            except ExportAdapterError as exc:
                raise ProtocolError(exc.code) from None
            return [_response(request_id, preview)], False

        if method == "attention/poll":
            state = self._read_state()
            events = self._attention_events(state)
            result = {
                "events_emitted": len(events),
                "source": state.get("source", {"status": "unknown"}),
                "counts": state.get("counts", {}),
            }
            return [*events, _response(request_id, result)], False

        if method == "shutdown":
            return [_response(request_id, {"shutdown": True})], True

        raise ProtocolError("unknown_method")


def run_protocol(
    stdin: TextIO,
    stdout: TextIO,
    stderr: TextIO,
    *,
    state_reader: Callable[[], Dict[str, Any]],
    preview_reader: Callable[[str, int, int], Dict[str, Any]],
) -> int:
    session = ReadProtocolSession(
        state_reader=state_reader,
        preview_reader=preview_reader,
    )
    for line in stdin:
        request_id: Any = None
        try:
            request = json.loads(line)
            if isinstance(request, dict):
                request_id = request.get("id")
            messages, should_shutdown = session.handle(request)
        except json.JSONDecodeError:
            messages = [_error(None, "invalid_json")]
            should_shutdown = False
        except ProtocolError as exc:
            messages = [_error(request_id, exc.code)]
            should_shutdown = False
        except (OSError, UnicodeError):
            print("codex-radar read protocol: local_read_failed", file=stderr)
            messages = [_error(request_id, "local_read_failed")]
            should_shutdown = False
        for message in messages:
            stdout.write(json.dumps(message, ensure_ascii=False, sort_keys=True) + "\n")
        stdout.flush()
        if should_shutdown:
            break
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the non-packaged read-only SSH protocol Stage 0 spike"
    )
    parser.add_argument("--state-dir")
    parser.add_argument("--codex-home")
    return parser


def main(argv: Optional[Iterable[str]] = None) -> int:
    args = _parser().parse_args(argv)
    state_dir = Path(args.state_dir).expanduser() if args.state_dir else None
    codex_home = Path(args.codex_home).expanduser() if args.codex_home else None
    return run_protocol(
        sys.stdin,
        sys.stdout,
        sys.stderr,
        state_reader=lambda: export_display_state(state_dir, codex_home=codex_home),
        preview_reader=lambda session_id, limit, version: export_transcript_preview(
            session_id,
            limit=limit,
            contract_version=version,
            state_dir=state_dir,
            codex_home=codex_home,
        ),
    )


if __name__ == "__main__":
    raise SystemExit(main())
