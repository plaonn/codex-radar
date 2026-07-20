from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Mapping, Optional

from .store import session_display_status
from .project_classification import classified_project


DISPLAY_STATE_CONTRACT = "codex-radar.display-state"
DISPLAY_STATE_VERSION = 1
ARCHIVE_STATES = {"active", "archived", "unknown"}
LIFECYCLE_STATUSES = {
    "active",
    "running",
    "tool_running",
    "waiting_approval",
    "done",
    "unknown",
}
SOURCE_STATUSES = {"ready", "partial", "unavailable", "invalid"}
CODE_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")
SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$")
TIMEZONE_PATTERN = re.compile(r"(?:Z|[+-]\d{2}:\d{2})$")


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _status(value: Any) -> str:
    candidate = _string(value)
    return candidate if candidate in LIFECYCLE_STATUSES else "unknown"


def _code(value: Any) -> str:
    candidate = _string(value).lower()
    return candidate if CODE_PATTERN.fullmatch(candidate) else ""


def _safe_label(value: Any, *, limit: int = 128) -> str:
    candidate = _string(value)
    if not candidate or len(candidate) > limit:
        return ""
    if any(character in candidate for character in ("/", "\\", "<", ">")):
        return ""
    if any(ord(character) < 32 or ord(character) == 127 for character in candidate):
        return ""
    return candidate


def sanitize_session_id(value: Any) -> str:
    candidate = _string(value)
    return candidate if SESSION_ID_PATTERN.fullmatch(candidate) else ""


def sanitize_iso_datetime(value: Any) -> str:
    candidate = _string(value)
    if not candidate or not TIMEZONE_PATTERN.search(candidate):
        return ""
    try:
        parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
    except ValueError:
        return ""
    if parsed.tzinfo is None:
        return ""
    return parsed.astimezone(timezone.utc).isoformat()


def _archive_state(value: Any) -> str:
    candidate = _string(value)
    return candidate if candidate in ARCHIVE_STATES else "unknown"


def _number(value: Any) -> Optional[float]:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result == result else None


def _int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _semantic_window(value: Any, expected_minutes: int) -> Optional[Dict[str, Any]]:
    if not isinstance(value, Mapping):
        return None
    result: Dict[str, Any] = {"window_minutes": expected_minutes}
    used = _number(value.get("used_percent"))
    remaining = _number(value.get("remaining_percent"))
    if used is not None:
        result["used_percent"] = max(0.0, min(100.0, used))
    if remaining is not None:
        result["remaining_percent"] = max(0.0, min(100.0, remaining))
    elif used is not None:
        result["remaining_percent"] = max(0.0, 100.0 - result["used_percent"])
    reset = sanitize_iso_datetime(value.get("resets_at_iso"))
    if reset:
        result["resets_at_iso"] = reset
    return result


def semantic_usage(snapshot: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    if not isinstance(snapshot, Mapping) or not snapshot.get("available"):
        reason = _code(snapshot.get("reason")) if isinstance(snapshot, Mapping) else ""
        return {
            "available": False,
            "reason": reason or "usage_unavailable",
            "pools": {"five_hour": None, "seven_day": None},
        }

    primary = snapshot.get("primary") if isinstance(snapshot.get("primary"), Mapping) else None
    secondary = snapshot.get("secondary") if isinstance(snapshot.get("secondary"), Mapping) else None
    five_hour: Optional[Mapping[str, Any]] = None
    seven_day: Optional[Mapping[str, Any]] = None
    for window in (primary, secondary):
        if window is None:
            continue
        minutes = _int(window.get("window_minutes"))
        if minutes == 300:
            five_hour = window
        elif minutes == 10080:
            seven_day = window

    # Older rollout events did not always include window_minutes.
    if five_hour is None and primary is not None and _int(primary.get("window_minutes")) is None:
        five_hour = primary
    if seven_day is None and secondary is not None and _int(secondary.get("window_minutes")) is None:
        seven_day = secondary

    result: Dict[str, Any] = {
        "available": True,
        "pools": {
            "five_hour": _semantic_window(five_hour, 300),
            "seven_day": _semantic_window(seven_day, 10080),
        },
    }
    observed_at = sanitize_iso_datetime(snapshot.get("observed_at"))
    plan_type = _code(snapshot.get("plan_type"))
    if observed_at:
        result["observed_at"] = observed_at
    if plan_type:
        result["plan_type"] = plan_type
    return result


def _session(
    source: Mapping[str, Any],
    *,
    session_id: str,
    archive_state: str,
    now: Optional[datetime],
) -> Dict[str, Any]:
    status = _status(source.get("status"))
    display_source = dict(source)
    display_source["status"] = status
    display_status = session_display_status(display_source, now=now)
    result: Dict[str, Any] = {
        "session_id": session_id,
        "status": status,
        "display_status": display_status if display_status else "unknown",
        "archive_state": archive_state,
        "requires_attention": status == "waiting_approval" and archive_state != "archived",
        "event_count": max(0, _int(source.get("event_count")) or 0),
    }
    project = _safe_label(classified_project(source.get("cwd"), source.get("project")))
    if project:
        result["project"] = project
    for field in ("first_seen_at", "last_seen_at", "display_state_started_at"):
        value = sanitize_iso_datetime(source.get(field))
        if value:
            result[field] = value
    model = _safe_label(source.get("model"))
    if model:
        result["model"] = model
    current_tool = _safe_label(source.get("current_tool")) if status == "tool_running" else ""
    if current_tool:
        result["current_tool"] = current_tool
    return result


def build_display_state(
    sessions: Mapping[str, Mapping[str, Any]],
    *,
    usage: Optional[Mapping[str, Any]] = None,
    archive_states: Optional[Mapping[str, str]] = None,
    source_status: str = "ready",
    source_reason: str = "",
    capabilities: Optional[Iterable[str]] = None,
    generated_at: Optional[str] = None,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Build the v1 sanitized display model without filesystem access or writes."""

    normalized_source_status = source_status if source_status in SOURCE_STATUSES else "invalid"
    archive_lookup = archive_states or {}
    items = []
    for value in sessions.values():
        if not isinstance(value, Mapping):
            continue
        session_id = sanitize_session_id(value.get("session_id"))
        if not session_id:
            continue
        items.append(
            _session(
                value,
                session_id=session_id,
                archive_state=_archive_state(archive_lookup.get(session_id, "unknown")),
                now=now,
            )
        )
    # Contract order is identity-stable, not a UI presentation decision.
    items.sort(key=lambda item: item["session_id"])

    visible = [item for item in items if item["archive_state"] != "archived"]
    counts = {
        "total": len(items),
        "visible": len(visible),
        "active": sum(item["archive_state"] == "active" for item in items),
        "archived": sum(item["archive_state"] == "archived" for item in items),
        "archive_unknown": sum(item["archive_state"] == "unknown" for item in items),
        "attention": sum(item["requires_attention"] for item in visible),
        "running": sum(item["display_status"] in {"running", "tool_running"} for item in visible),
        "done": sum(item["status"] == "done" for item in visible),
    }
    source: Dict[str, Any] = {"status": normalized_source_status}
    reason_code = _code(source_reason)
    if reason_code:
        source["reason"] = reason_code

    return {
        "contract": DISPLAY_STATE_CONTRACT,
        "version": DISPLAY_STATE_VERSION,
        "generated_at": sanitize_iso_datetime(generated_at) or _utc_now(),
        "source": source,
        "capabilities": sorted({_code(item) for item in (capabilities or ()) if _code(item)}),
        "counts": counts,
        "sessions": items,
        "usage": semantic_usage(usage),
    }
