from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Dict, Iterable, List, Optional, TextIO

from .store import iter_sessions, session_display_status


Session = Dict[str, object]
SeenState = Dict[str, str]
DEFAULT_WATCH_STATUSES = ("done",)


def _session_key(session: Session) -> str:
    session_id = str(session.get("session_id") or "")
    if session_id:
        return session_id
    return f"unknown:{session.get('first_seen_at') or session.get('last_seen_at') or ''}"


def _normalize_statuses(statuses: Optional[Iterable[str]]) -> tuple[str, ...]:
    return tuple(str(status) for status in (statuses or DEFAULT_WATCH_STATUSES))


def watch_alerts(
    sessions: Iterable[Session],
    seen: SeenState,
    statuses: Optional[Iterable[str]] = DEFAULT_WATCH_STATUSES,
) -> List[Session]:
    watched = set(_normalize_statuses(statuses))
    alerts: List[Session] = []
    for session in sessions:
        if session_display_status(session) not in watched:
            continue
        key = _session_key(session)
        last_seen_at = str(session.get("last_seen_at") or "")
        if seen.get(key) == last_seen_at:
            continue
        seen[key] = last_seen_at
        alerts.append(session)
    return alerts


def waiting_approval_alerts(sessions: Iterable[Session], seen: SeenState) -> List[Session]:
    return watch_alerts(sessions, seen, ("waiting_approval",))


def format_status_alert(session: Session) -> str:
    status = session_display_status(session)
    project = str(session.get("project") or "-")
    event = str(session.get("last_event_name") or "-")
    return f"codex-radar: {status} project={project} event={event}"


def format_waiting_approval_alert(session: Session) -> str:
    return format_status_alert(session)


def seed_seen(sessions: Iterable[Session], seen: SeenState, statuses: Optional[Iterable[str]]) -> None:
    watched = set(_normalize_statuses(statuses))
    for session in sessions:
        if session_display_status(session) not in watched:
            continue
        seen[_session_key(session)] = str(session.get("last_seen_at") or "")


def format_watch_start(sessions: Iterable[Session], statuses: Optional[Iterable[str]]) -> str:
    rows = list(sessions)
    watched = set(_normalize_statuses(statuses))
    matching = sum(1 for session in rows if session_display_status(session) in watched)
    status_text = ",".join(sorted(watched)) or "-"
    return f"codex-radar: watching status={status_text} sessions={len(rows)} matching={matching}"


def run_watch(
    state_dir: Optional[Path] = None,
    *,
    interval_seconds: float = 2.0,
    once: bool = False,
    bell: bool = True,
    statuses: Optional[Iterable[str]] = DEFAULT_WATCH_STATUSES,
    include_existing: bool = False,
    announce: bool = True,
    out: Optional[TextIO] = None,
) -> int:
    output = out or sys.stdout
    seen: SeenState = {}
    watch_statuses = _normalize_statuses(statuses)
    initial_sessions = list(iter_sessions(state_dir))
    if announce:
        print(format_watch_start(initial_sessions, watch_statuses), file=output, flush=True)
    if not include_existing:
        seed_seen(initial_sessions, seen, watch_statuses)
    try:
        while True:
            alerts = watch_alerts(iter_sessions(state_dir), seen, watch_statuses)
            for session in alerts:
                if bell:
                    print("\a", end="", file=output)
                print(format_status_alert(session), file=output, flush=True)

            if once:
                return 0
            time.sleep(interval_seconds)
    except KeyboardInterrupt:
        return 130
