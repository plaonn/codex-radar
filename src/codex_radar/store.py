from __future__ import annotations

import contextlib
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, Optional


EVENT_STATUS = {
    "SessionStart": "active",
    "UserPromptSubmit": "running",
    "PreToolUse": "tool_running",
    "PostToolUse": "running",
    "PermissionRequest": "waiting_approval",
    "Stop": "done",
    "SubagentStart": "running",
    "SubagentStop": "done",
}

STALE_SESSION_SECONDS = 30 * 60
STALE_ELIGIBLE_STATUSES = {"active", "running", "tool_running"}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def parse_timestamp(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def is_stale_session(
    session: Dict[str, Any],
    *,
    now: Optional[datetime] = None,
    stale_seconds: int = STALE_SESSION_SECONDS,
) -> bool:
    status = _string(session.get("status"))
    if status not in STALE_ELIGIBLE_STATUSES:
        return False

    last_seen = parse_timestamp(session.get("last_seen_at"))
    if last_seen is None:
        return False

    reference = now or datetime.now(timezone.utc)
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=timezone.utc)
    reference = reference.astimezone(timezone.utc)
    return reference - last_seen > timedelta(seconds=stale_seconds)


def session_display_status(
    session: Dict[str, Any],
    *,
    now: Optional[datetime] = None,
    stale_seconds: int = STALE_SESSION_SECONDS,
) -> str:
    if is_stale_session(session, now=now, stale_seconds=stale_seconds):
        return "stale"
    return _string(session.get("status"))


def session_seen_since(session: Dict[str, Any], since: datetime) -> bool:
    last_seen_at = parse_timestamp(session.get("last_seen_at"))
    return last_seen_at is not None and last_seen_at >= since


def default_state_dir() -> Path:
    explicit = os.environ.get("CODEX_RADAR_HOME")
    if explicit:
        return Path(explicit).expanduser()

    xdg_state = os.environ.get("XDG_STATE_HOME")
    if xdg_state:
        return Path(xdg_state).expanduser() / "codex-radar"

    return Path.home() / ".local" / "state" / "codex-radar"


def ensure_state_dir(state_dir: Optional[Path] = None) -> Path:
    resolved = Path(state_dir) if state_dir is not None else default_state_dir()
    resolved.mkdir(parents=True, exist_ok=True)
    return resolved


def events_path(state_dir: Optional[Path] = None) -> Path:
    return ensure_state_dir(state_dir) / "events.jsonl"


def sessions_path(state_dir: Optional[Path] = None) -> Path:
    return ensure_state_dir(state_dir) / "sessions.json"


def _string(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


def _truncate(value: str, limit: int = 500) -> str:
    value = value.strip()
    if len(value) <= limit:
        return value
    return value[: limit - 1].rstrip() + "..."


def _find_first(payload: Dict[str, Any], keys: Iterable[str]) -> Any:
    for key in keys:
        if key in payload and payload[key] not in (None, ""):
            return payload[key]
    return None


def _tool_name(payload: Dict[str, Any]) -> str:
    direct = _find_first(payload, ("tool_name", "toolName", "tool", "matcher"))
    if direct:
        return _string(direct)

    tool_input = _find_first(payload, ("tool_input", "toolInput"))
    if isinstance(tool_input, dict):
        direct = _find_first(tool_input, ("name", "tool_name", "toolName"))
        if direct:
            return _string(direct)

    return ""


def normalize_event(payload: Dict[str, Any], recorded_at: Optional[str] = None) -> Dict[str, Any]:
    event_name = _string(
        _find_first(payload, ("hook_event_name", "hookEventName", "event_name", "event"))
    )
    status = EVENT_STATUS.get(event_name, "unknown")
    cwd = _string(_find_first(payload, ("cwd", "current_working_directory", "currentWorkingDirectory")))
    project = Path(cwd).name if cwd else ""
    last_message = _string(_find_first(payload, ("last_assistant_message", "lastAssistantMessage")))

    return {
        "recorded_at": recorded_at or utc_now(),
        "event_name": event_name or "unknown",
        "session_id": _string(_find_first(payload, ("session_id", "sessionId"))),
        "turn_id": _string(_find_first(payload, ("turn_id", "turnId"))),
        "status": status,
        "cwd": cwd,
        "project": project,
        "transcript_path": _string(_find_first(payload, ("transcript_path", "transcriptPath"))),
        "model": _string(_find_first(payload, ("model", "model_name", "modelName"))),
        "permission_mode": _string(
            _find_first(payload, ("permission_mode", "permissionMode", "approval_policy"))
        ),
        "tool_name": _tool_name(payload),
        "last_assistant_message": _truncate(last_message),
        "raw": payload,
    }


@contextlib.contextmanager
def _state_lock(state_dir: Path) -> Iterator[None]:
    lock_path = state_dir / ".lock"
    with lock_path.open("a+", encoding="utf-8") as lock_file:
        try:
            import fcntl
        except ImportError:
            yield
        else:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def append_event(event: Dict[str, Any], state_dir: Optional[Path] = None) -> None:
    path = events_path(state_dir)
    line = json.dumps(event, ensure_ascii=False, sort_keys=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def load_sessions(state_dir: Optional[Path] = None) -> Dict[str, Dict[str, Any]]:
    path = sessions_path(state_dir)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(data, dict):
        return {}
    sessions = data.get("sessions", data)
    if not isinstance(sessions, dict):
        return {}
    return {str(key): value for key, value in sessions.items() if isinstance(value, dict)}


def save_sessions(sessions: Dict[str, Dict[str, Any]], state_dir: Optional[Path] = None) -> None:
    path = sessions_path(state_dir)
    payload = {
        "schema_version": 1,
        "updated_at": utc_now(),
        "sessions": sessions,
    }
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(path)


def update_session_cache(event: Dict[str, Any], state_dir: Optional[Path] = None) -> Dict[str, Any]:
    sessions = load_sessions(state_dir)
    session_id = event.get("session_id") or f"unknown:{event['recorded_at']}"
    previous = sessions.get(session_id, {})
    current_tool = event.get("tool_name") or previous.get("current_tool", "")
    if event.get("event_name") in {"PostToolUse", "Stop", "SubagentStop"}:
        current_tool = ""

    session = {
        "session_id": session_id,
        "first_seen_at": previous.get("first_seen_at") or event["recorded_at"],
        "last_seen_at": event["recorded_at"],
        "last_event_name": event.get("event_name", "unknown"),
        "status": event.get("status", "unknown"),
        "cwd": event.get("cwd") or previous.get("cwd", ""),
        "project": event.get("project") or previous.get("project", ""),
        "transcript_path": event.get("transcript_path") or previous.get("transcript_path", ""),
        "model": event.get("model") or previous.get("model", ""),
        "permission_mode": event.get("permission_mode") or previous.get("permission_mode", ""),
        "turn_id": event.get("turn_id") or previous.get("turn_id", ""),
        "current_tool": current_tool,
        "last_assistant_message": event.get("last_assistant_message")
        or previous.get("last_assistant_message", ""),
        "event_count": int(previous.get("event_count", 0)) + 1,
    }
    sessions[session_id] = session
    save_sessions(sessions, state_dir)
    return session


def record_hook_event(payload: Dict[str, Any], state_dir: Optional[Path] = None) -> Dict[str, Any]:
    resolved = ensure_state_dir(state_dir)
    event = normalize_event(payload)
    with _state_lock(resolved):
        append_event(event, resolved)
        session = update_session_cache(event, resolved)
    return session


def iter_sessions(state_dir: Optional[Path] = None) -> Iterator[Dict[str, Any]]:
    sessions = load_sessions(state_dir)
    yield from sorted(sessions.values(), key=lambda item: item.get("last_seen_at", ""), reverse=True)
