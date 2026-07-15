from __future__ import annotations

import json
import os
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, Mapping, Optional

from .display_state import build_display_state, sanitize_session_id
from .store import CACHE_SCHEMA_VERSION, sessions_path
from .transcript import iter_jsonl
from .transcript_preview import build_transcript_preview
from .usage import default_codex_home, usage_snapshot


MAX_TRANSCRIPT_FILES = 10_000
DISPLAY_CAPABILITIES = ("archive-state", "transcript-preview", "usage")


class ExportAdapterError(Exception):
    """A protocol-safe export failure identified only by a stable code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class TranscriptCandidate:
    path: Path
    archive_state: str
    modified_ns: int


def _load_session_source(
    state_dir: Optional[Path],
) -> tuple[Dict[str, Dict[str, Any]], str, str]:
    path = sessions_path(state_dir, create=False)
    if not path.exists():
        return {}, "unavailable", "state_unavailable"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, UnicodeError):
        return {}, "invalid", "state_invalid"
    if not isinstance(data, dict):
        return {}, "invalid", "state_invalid"
    version = data.get("schema_version", CACHE_SCHEMA_VERSION)
    if type(version) is not int or version != CACHE_SCHEMA_VERSION:
        return {}, "invalid", "state_version_unsupported"
    raw_sessions = data.get("sessions", data)
    if not isinstance(raw_sessions, dict):
        return {}, "invalid", "state_invalid"
    sessions = {
        str(key): value
        for key, value in raw_sessions.items()
        if isinstance(value, dict)
    }
    entries_invalid = len(sessions) != len(raw_sessions) or any(
        not sanitize_session_id(session.get("session_id"))
        for session in sessions.values()
    )
    if entries_invalid:
        return sessions, "partial", "state_entries_invalid"
    return sessions, "ready", ""


def _candidate_files(codex_home: Path) -> list[TranscriptCandidate]:
    candidates: list[TranscriptCandidate] = []
    visited = 0
    roots = (
        (codex_home / "sessions", "active"),
        (codex_home / "archived_sessions", "archived"),
    )
    for root, archive_state in roots:
        if not root.is_dir():
            continue
        for current, directory_names, file_names in os.walk(
            root,
            topdown=True,
            onerror=lambda _error: None,
        ):
            directory_names.sort()
            file_names.sort()
            for file_name in file_names:
                visited += 1
                if visited > MAX_TRANSCRIPT_FILES:
                    return candidates
                if not file_name.endswith(".jsonl"):
                    continue
                path = Path(current) / file_name
                try:
                    file_stat = path.lstat()
                except OSError:
                    continue
                if stat.S_ISREG(file_stat.st_mode):
                    candidates.append(
                        TranscriptCandidate(
                            path=path,
                            archive_state=archive_state,
                            modified_ns=file_stat.st_mtime_ns,
                        )
                    )
    return candidates


def _newest(candidates: Iterable[TranscriptCandidate]) -> Optional[TranscriptCandidate]:
    return max(
        candidates,
        key=lambda item: (item.modified_ns, str(item.path)),
        default=None,
    )


def _filename_matches_session(path: Path, session_id: str) -> bool:
    return path.stem == session_id or path.stem.endswith(f"-{session_id}")


def _candidate_for_session(
    session_id: str,
    session: Mapping[str, Any],
    candidates: Iterable[TranscriptCandidate],
) -> Optional[TranscriptCandidate]:
    candidate_list = candidates if isinstance(candidates, list) else list(candidates)
    transcript_path = session.get("transcript_path")
    explicit = (
        Path(transcript_path).expanduser()
        if isinstance(transcript_path, str) and transcript_path
        else None
    )
    if explicit is not None:
        try:
            explicit_stat = explicit.lstat()
            if stat.S_ISREG(explicit_stat.st_mode):
                known = next((item for item in candidate_list if item.path == explicit), None)
                if known is not None:
                    return known
                return TranscriptCandidate(explicit, "active", explicit_stat.st_mtime_ns)
        except OSError:
            pass
        if _filename_matches_session(explicit, session_id):
            by_name = _newest(
                item for item in candidate_list if item.path.name == explicit.name
            )
            if by_name is not None:
                return by_name
    return _newest(
        item
        for item in candidate_list
        if _filename_matches_session(item.path, session_id)
    )


def _session_by_id(
    sessions: Mapping[str, Mapping[str, Any]], session_id: str
) -> Optional[Mapping[str, Any]]:
    direct = sessions.get(session_id)
    if isinstance(direct, Mapping) and sanitize_session_id(direct.get("session_id")) == session_id:
        return direct
    return next(
        (
            session
            for session in sessions.values()
            if isinstance(session, Mapping)
            and sanitize_session_id(session.get("session_id")) == session_id
        ),
        None,
    )


def export_display_state(
    state_dir: Optional[Path] = None,
    *,
    codex_home: Optional[Path] = None,
) -> Dict[str, Any]:
    sessions, source_status, source_reason = _load_session_source(state_dir)
    home = codex_home or default_codex_home()
    candidates = _candidate_files(home) if sessions else []
    archive_states: Dict[str, str] = {}
    for session in sessions.values():
        session_id = sanitize_session_id(session.get("session_id"))
        if not session_id:
            continue
        candidate = _candidate_for_session(session_id, session, candidates)
        archive_states[session_id] = candidate.archive_state if candidate else "unknown"
    try:
        usage = usage_snapshot(home)
    except (OSError, UnicodeError):
        usage = {"available": False, "reason": "usage_unavailable"}
    return build_display_state(
        sessions,
        usage=usage,
        archive_states=archive_states,
        source_status=source_status,
        source_reason=source_reason,
        capabilities=DISPLAY_CAPABILITIES,
    )


def export_transcript_preview(
    session_id: str,
    *,
    limit: int,
    state_dir: Optional[Path] = None,
    codex_home: Optional[Path] = None,
) -> Dict[str, Any]:
    safe_session_id = sanitize_session_id(session_id)
    if not safe_session_id:
        raise ExportAdapterError("invalid_session_id")
    sessions, source_status, _source_reason = _load_session_source(state_dir)
    if source_status not in {"ready", "partial"}:
        raise ExportAdapterError("state_unavailable")
    session = _session_by_id(sessions, safe_session_id)
    if session is None:
        raise ExportAdapterError("session_not_found")
    candidate = _candidate_for_session(
        safe_session_id,
        session,
        _candidate_files(codex_home or default_codex_home()),
    )
    if candidate is None:
        raise ExportAdapterError("transcript_unavailable")
    try:
        return build_transcript_preview(
            safe_session_id,
            iter_jsonl(candidate.path),
            limit=limit,
        )
    except (OSError, UnicodeError):
        raise ExportAdapterError("transcript_unreadable") from None
