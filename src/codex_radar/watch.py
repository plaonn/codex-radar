from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Dict, Iterable, List, Optional, TextIO

from .store import iter_sessions, session_display_status


Session = Dict[str, object]
SeenState = Dict[str, str]


def _session_key(session: Session) -> str:
    session_id = str(session.get("session_id") or "")
    if session_id:
        return session_id
    return f"unknown:{session.get('first_seen_at') or session.get('last_seen_at') or ''}"


def waiting_approval_alerts(sessions: Iterable[Session], seen: SeenState) -> List[Session]:
    alerts: List[Session] = []
    for session in sessions:
        if session_display_status(session) != "waiting_approval":
            continue
        key = _session_key(session)
        last_seen_at = str(session.get("last_seen_at") or "")
        if seen.get(key) == last_seen_at:
            continue
        seen[key] = last_seen_at
        alerts.append(session)
    return alerts


def format_waiting_approval_alert(session: Session) -> str:
    project = str(session.get("project") or "-")
    event = str(session.get("last_event_name") or "-")
    return f"codex-radar: waiting_approval project={project} event={event}"


def run_watch(
    state_dir: Optional[Path] = None,
    *,
    interval_seconds: float = 2.0,
    once: bool = False,
    bell: bool = True,
    out: Optional[TextIO] = None,
) -> int:
    output = out or sys.stdout
    seen: SeenState = {}
    try:
        while True:
            alerts = waiting_approval_alerts(iter_sessions(state_dir), seen)
            for session in alerts:
                if bell:
                    print("\a", end="", file=output)
                print(format_waiting_approval_alert(session), file=output, flush=True)

            if once:
                return 0
            time.sleep(interval_seconds)
    except KeyboardInterrupt:
        return 130
