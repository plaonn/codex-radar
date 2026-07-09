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

CACHE_SCHEMA_VERSION = 1
CONFIG_SCHEMA_VERSION = 1
DEFAULT_RETENTION_DAYS = 7
SESSION_CACHE_FIELDS = (
    "session_id",
    "first_seen_at",
    "last_seen_at",
    "last_event_name",
    "status",
    "display_state",
    "display_state_started_at",
    "cwd",
    "project",
    "transcript_path",
    "model",
    "permission_mode",
    "turn_id",
    "current_tool",
    "last_assistant_message",
    "event_count",
)
STALE_SESSION_SECONDS = 30 * 60
STALE_ELIGIBLE_STATUSES = {"active", "running", "tool_running"}
DISPLAY_STATE_BY_STATUS = {
    "tool_running": "running",
}


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


def display_state_for_status(status: Any) -> str:
    value = _string(status) or "unknown"
    return DISPLAY_STATE_BY_STATUS.get(value, value)


def default_state_dir() -> Path:
    explicit = os.environ.get("CODEX_RADAR_HOME")
    if explicit:
        return Path(explicit).expanduser()

    xdg_state = os.environ.get("XDG_STATE_HOME")
    if xdg_state:
        return Path(xdg_state).expanduser() / "codex-radar"

    return Path.home() / ".local" / "state" / "codex-radar"


def state_dir_path(state_dir: Optional[Path] = None) -> Path:
    return Path(state_dir) if state_dir is not None else default_state_dir()


def ensure_state_dir(state_dir: Optional[Path] = None) -> Path:
    resolved = state_dir_path(state_dir)
    resolved.mkdir(parents=True, exist_ok=True)
    return resolved


def config_path(state_dir: Optional[Path] = None, *, create: bool = True) -> Path:
    directory = ensure_state_dir(state_dir) if create else state_dir_path(state_dir)
    return directory / "config.json"


def sessions_path(state_dir: Optional[Path] = None, *, create: bool = True) -> Path:
    directory = ensure_state_dir(state_dir) if create else state_dir_path(state_dir)
    return directory / "sessions.json"


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


def _retention_days(value: Any, default: int = DEFAULT_RETENTION_DAYS) -> int:
    try:
        days = int(value)
    except (TypeError, ValueError):
        return default
    return max(0, days)


def _reference_time(value: Optional[Any] = None) -> datetime:
    parsed = parse_timestamp(value)
    if parsed is not None:
        return parsed
    return datetime.now(timezone.utc)


def _prune_session_mapping(
    sessions: Dict[str, Dict[str, Any]],
    *,
    retention_days: int,
    now: Optional[datetime] = None,
) -> tuple[Dict[str, Dict[str, Any]], list[str], Optional[datetime]]:
    if retention_days <= 0:
        return sessions, [], None

    reference = now or datetime.now(timezone.utc)
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=timezone.utc)
    reference = reference.astimezone(timezone.utc)
    cutoff = reference - timedelta(days=retention_days)
    kept: Dict[str, Dict[str, Any]] = {}
    removed: list[str] = []
    for session_id, session in sessions.items():
        last_seen_at = parse_timestamp(session.get("last_seen_at"))
        if last_seen_at is not None and last_seen_at < cutoff:
            removed.append(session_id)
        else:
            kept[session_id] = session
    return kept, removed, cutoff


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


def load_sessions(state_dir: Optional[Path] = None) -> Dict[str, Dict[str, Any]]:
    path = sessions_path(state_dir, create=False)
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


def load_config(state_dir: Optional[Path] = None) -> Dict[str, Any]:
    path = config_path(state_dir, create=False)
    config: Dict[str, Any] = {
        "schema_version": CONFIG_SCHEMA_VERSION,
        "retention_days": DEFAULT_RETENTION_DAYS,
    }
    if not path.exists():
        return config
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return config
    if not isinstance(data, dict):
        return config
    config["retention_days"] = _retention_days(data.get("retention_days"))
    return config


def save_config(config: Dict[str, Any], state_dir: Optional[Path] = None) -> Dict[str, Any]:
    normalized = {
        "schema_version": CONFIG_SCHEMA_VERSION,
        "retention_days": _retention_days(config.get("retention_days")),
    }
    path = config_path(state_dir)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps(normalized, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    tmp.replace(path)
    return normalized


def save_sessions(sessions: Dict[str, Dict[str, Any]], state_dir: Optional[Path] = None) -> None:
    path = sessions_path(state_dir)
    payload = {
        "schema_version": CACHE_SCHEMA_VERSION,
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
    display_state = display_state_for_status(event.get("status", "unknown"))
    previous_display_state = display_state_for_status(
        previous.get("display_state") or previous.get("status", "")
    )
    display_state_started_at = (
        previous.get("display_state_started_at")
        if previous_display_state == display_state
        else ""
    ) or event["recorded_at"]

    session = {
        "session_id": session_id,
        "first_seen_at": previous.get("first_seen_at") or event["recorded_at"],
        "last_seen_at": event["recorded_at"],
        "last_event_name": event.get("event_name", "unknown"),
        "status": event.get("status", "unknown"),
        "display_state": display_state,
        "display_state_started_at": display_state_started_at,
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
    sessions, _, _ = _prune_session_mapping(
        sessions,
        retention_days=load_config(state_dir).get("retention_days", DEFAULT_RETENTION_DAYS),
        now=_reference_time(event.get("recorded_at")),
    )
    save_sessions(sessions, state_dir)
    return session


def prune_sessions(
    state_dir: Optional[Path] = None,
    *,
    retention_days: Optional[int] = None,
    now: Optional[datetime] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    resolved = state_dir_path(state_dir)
    config = load_config(resolved)
    days = _retention_days(
        retention_days if retention_days is not None else config.get("retention_days")
    )
    sessions = load_sessions(resolved)
    kept, removed_ids, cutoff = _prune_session_mapping(
        sessions,
        retention_days=days,
        now=now,
    )

    legacy_events_path = resolved / "events.jsonl"
    legacy_events_removed = legacy_events_path.exists()

    if not dry_run:
        if removed_ids:
            save_sessions(kept, resolved)
        if legacy_events_path.exists():
            legacy_events_path.unlink()

    return {
        "retention_days": days,
        "cutoff": cutoff.isoformat() if cutoff else "",
        "removed_sessions": sorted(removed_ids),
        "kept_sessions": len(kept),
        "legacy_events_removed": legacy_events_removed,
        "dry_run": dry_run,
    }


def record_hook_event(payload: Dict[str, Any], state_dir: Optional[Path] = None) -> Dict[str, Any]:
    resolved = ensure_state_dir(state_dir)
    event = normalize_event(payload)
    with _state_lock(resolved):
        session = update_session_cache(event, resolved)
        legacy_events_path = resolved / "events.jsonl"
        if legacy_events_path.exists():
            legacy_events_path.unlink()
    return session


def iter_sessions(state_dir: Optional[Path] = None) -> Iterator[Dict[str, Any]]:
    sessions = load_sessions(state_dir)
    yield from sorted(sessions.values(), key=lambda item: item.get("last_seen_at", ""), reverse=True)
