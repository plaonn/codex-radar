from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Optional


ROLLOUT_GLOB = "**/rollout-*.jsonl"
USAGE_SOURCE = "codex-session-rollout"


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


def _token_count_payload(line: str) -> Optional[Dict[str, Any]]:
    try:
        item = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(item, dict):
        return None
    payload = item.get("payload")
    if not isinstance(payload, dict) or payload.get("type") != "token_count":
        return None
    return payload


def _latest_token_count_in_file(path: Path) -> Optional[Dict[str, Any]]:
    latest: Optional[Dict[str, Any]] = None
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                if "token_count" not in line:
                    continue
                payload = _token_count_payload(line)
                if payload is not None:
                    latest = payload
    except OSError:
        return None
    return latest


def recent_rollout_files(codex_home: Optional[Path] = None, *, limit: int = 30) -> list[Path]:
    sessions_dir = (codex_home or default_codex_home()) / "sessions"
    if not sessions_dir.exists():
        return []
    files = [path for path in sessions_dir.glob(ROLLOUT_GLOB) if path.is_file()]
    files.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    return files[: max(0, limit)]


def latest_token_count(files: Iterable[Path]) -> tuple[Optional[Dict[str, Any]], Optional[datetime], int]:
    checked = 0
    for path in files:
        checked += 1
        payload = _latest_token_count_in_file(path)
        if payload is None:
            continue
        try:
            observed_at = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).replace(microsecond=0)
        except OSError:
            observed_at = None
        return payload, observed_at, checked
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
        "generated_at": generated_at or utc_now(),
        "checked_files": checked,
    }
    if payload is None:
        return {**base, "reason": "token_count_unavailable"}

    info = payload.get("info") if isinstance(payload.get("info"), dict) else {}
    rate_limits = payload.get("rate_limits") if isinstance(payload.get("rate_limits"), dict) else None
    observed = observed_at.isoformat() if observed_at else None
    token_usage = {
        "context_window": info.get("model_context_window"),
        "last_token_usage": info.get("last_token_usage") if isinstance(info.get("last_token_usage"), dict) else None,
        "total_token_usage": info.get("total_token_usage") if isinstance(info.get("total_token_usage"), dict) else None,
    }
    if rate_limits is None:
        return {
            **base,
            "observed_at": observed,
            "reason": "rate_limits_unavailable",
            **token_usage,
        }

    return {
        **base,
        "available": True,
        "observed_at": observed,
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
    primary = snapshot.get("primary") if isinstance(snapshot.get("primary"), dict) else {}
    secondary = snapshot.get("secondary") if isinstance(snapshot.get("secondary"), dict) else {}
    parts = []
    if "used_percent" in primary:
        parts.append(f"5h used {primary['used_percent']:.0f}%")
    if "used_percent" in secondary:
        parts.append(f"7d used {secondary['used_percent']:.0f}%")
    if snapshot.get("plan_type"):
        parts.append(f"plan {snapshot['plan_type']}")
    return "Codex usage: " + ", ".join(parts)
