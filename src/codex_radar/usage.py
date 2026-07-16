from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Optional


ROLLOUT_GLOB = "**/rollout-*.jsonl"
USAGE_SOURCE = "codex-session-rollout"
USAGE_SOURCE_ADAPTER_REVISION = "codex-session-rollout-v2"
CLIENT_EVENT_TIMESTAMP_PROVENANCE = "rollout-envelope-timestamp"
UNAVAILABLE_TIMESTAMP_PROVENANCE = "unavailable"


@dataclass(frozen=True)
class TokenCountEvent:
    payload: Dict[str, Any]
    client_event_at: Optional[datetime]


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def default_codex_home() -> Path:
    explicit = os.environ.get("CODEX_HOME")
    if explicit:
        return Path(explicit).expanduser()
    return Path.home() / ".codex"


def _iso_from_timestamp(value: Any) -> Optional[str]:
    try:
        timestamp = float(value)
    except (TypeError, ValueError):
        return None
    return datetime.fromtimestamp(timestamp, timezone.utc).replace(microsecond=0).isoformat()


def _number(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _rate_window(value: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(value, dict):
        return None
    used_percent = _number(value.get("used_percent"))
    resets_at = value.get("resets_at")
    window = {
        "used_percent": used_percent,
        "remaining_percent": None if used_percent is None else max(0.0, 100.0 - used_percent),
        "window_minutes": _safe_int(value.get("window_minutes")),
        "resets_at": _safe_int(resets_at),
        "resets_at_iso": _iso_from_timestamp(resets_at),
    }
    return {key: item for key, item in window.items() if item is not None}


def _client_event_timestamp(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed.astimezone(timezone.utc)


def _token_count_event(line: str) -> Optional[TokenCountEvent]:
    try:
        item = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(item, dict) or item.get("type") != "event_msg":
        return None
    payload = item.get("payload")
    if not isinstance(payload, dict) or payload.get("type") != "token_count":
        return None
    return TokenCountEvent(
        payload=payload,
        client_event_at=_client_event_timestamp(item.get("timestamp")),
    )


def _token_count_events_in_file(path: Path) -> list[TokenCountEvent]:
    events: list[TokenCountEvent] = []
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                if "token_count" not in line:
                    continue
                event = _token_count_event(line)
                if event is not None:
                    events.append(event)
    except OSError:
        return []
    return events


def recent_rollout_files(codex_home: Optional[Path] = None, *, limit: int = 30) -> list[Path]:
    sessions_dir = (codex_home or default_codex_home()) / "sessions"
    if not sessions_dir.exists():
        return []
    files = [path for path in sessions_dir.glob(ROLLOUT_GLOB) if path.is_file()]
    files.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    return files[: max(0, limit)]


def latest_token_count(files: Iterable[Path]) -> tuple[Optional[Dict[str, Any]], Optional[datetime], int]:
    checked = 0
    latest: Optional[TokenCountEvent] = None
    fallback: Optional[TokenCountEvent] = None
    seen: set[tuple[str, str]] = set()
    for path in files:
        checked += 1
        events = _token_count_events_in_file(path)
        if not events:
            continue
        if fallback is None:
            fallback = events[-1]
        for event in events:
            if event.client_event_at is None:
                continue
            event_at = event.client_event_at.isoformat()
            payload_key = json.dumps(event.payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
            event_key = (event_at, payload_key)
            if event_key in seen:
                continue
            seen.add(event_key)
            if latest is None or event.client_event_at > latest.client_event_at:
                latest = event
    if latest is not None:
        return latest.payload, latest.client_event_at, checked
    if fallback is not None:
        return fallback.payload, None, checked
    return None, None, checked


def usage_snapshot(
    codex_home: Optional[Path] = None,
    *,
    file_limit: int = 30,
    generated_at: Optional[str] = None,
) -> Dict[str, Any]:
    files = recent_rollout_files(codex_home, limit=file_limit)
    payload, observed_at, checked = latest_token_count(files)
    base: Dict[str, Any] = {
        "available": False,
        "source": USAGE_SOURCE,
        "source_adapter_revision": USAGE_SOURCE_ADAPTER_REVISION,
        "generated_at": generated_at or utc_now(),
        "checked_files": checked,
    }
    if payload is None:
        return {**base, "reason": "token_count_unavailable"}

    info = payload.get("info") if isinstance(payload.get("info"), dict) else {}
    rate_limits = payload.get("rate_limits") if isinstance(payload.get("rate_limits"), dict) else None
    client_event_at = observed_at.isoformat() if observed_at else None
    event_time = {
        "timestamp_provenance": (
            CLIENT_EVENT_TIMESTAMP_PROVENANCE
            if client_event_at is not None
            else UNAVAILABLE_TIMESTAMP_PROVENANCE
        )
    }
    if client_event_at is not None:
        event_time.update(
            {
                "client_event_at": client_event_at,
                "observed_at": client_event_at,
                "observed_at_provenance": "client_event_at",
            }
        )
    token_usage = {
        "context_window": info.get("model_context_window"),
        "last_token_usage": info.get("last_token_usage") if isinstance(info.get("last_token_usage"), dict) else None,
        "total_token_usage": info.get("total_token_usage") if isinstance(info.get("total_token_usage"), dict) else None,
    }
    if rate_limits is None:
        return {
            **base,
            **event_time,
            "reason": "rate_limits_unavailable",
            **token_usage,
        }

    return {
        **base,
        "available": True,
        **event_time,
        "limit_id": rate_limits.get("limit_id"),
        "limit_name": rate_limits.get("limit_name"),
        "plan_type": rate_limits.get("plan_type"),
        "primary": _rate_window(rate_limits.get("primary")),
        "secondary": _rate_window(rate_limits.get("secondary")),
        "credits": rate_limits.get("credits"),
        "individual_limit": rate_limits.get("individual_limit"),
        "rate_limit_reached_type": rate_limits.get("rate_limit_reached_type"),
        **token_usage,
    }


def format_usage_snapshot(snapshot: Dict[str, Any]) -> str:
    if not snapshot.get("available"):
        reason = snapshot.get("reason") or "unavailable"
        return f"Codex usage unavailable ({reason})"
    primary = snapshot.get("primary") if isinstance(snapshot.get("primary"), dict) else None
    secondary = snapshot.get("secondary") if isinstance(snapshot.get("secondary"), dict) else None
    five_hour = next(
        (window for window in (primary, secondary) if window and window.get("window_minutes") == 300),
        None,
    )
    seven_day = next(
        (window for window in (primary, secondary) if window and window.get("window_minutes") == 10080),
        None,
    )
    if five_hour is None and primary and primary.get("window_minutes") is None:
        five_hour = primary
    if seven_day is None and secondary and secondary.get("window_minutes") is None:
        seven_day = secondary
    parts = []
    if five_hour and "used_percent" in five_hour:
        parts.append(f"5h used {five_hour['used_percent']:.0f}%")
    if seven_day and "used_percent" in seven_day:
        parts.append(f"7d used {seven_day['used_percent']:.0f}%")
    if snapshot.get("plan_type"):
        parts.append(f"plan {snapshot['plan_type']}")
    return "Codex usage: " + ", ".join(parts)
