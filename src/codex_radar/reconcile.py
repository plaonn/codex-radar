from __future__ import annotations

import json
from contextlib import nullcontext
from pathlib import Path
from typing import Any, Dict, Iterator, Optional

from .store import (
    STALE_ELIGIBLE_STATUSES,
    _state_lock,
    display_state_for_status,
    load_sessions,
    parse_timestamp,
    save_sessions,
    state_dir_path,
)


DEFAULT_ROLLOUT_TAIL_BYTES = 512 * 1024
TERMINAL_EVENT_STATUS = {
    "task_complete": ("done", "RolloutTaskComplete"),
    "turn_aborted": ("unknown", "RolloutTurnAborted"),
}


def _tail_lines(path: Path, max_bytes: int) -> Iterator[str]:
    with path.open("rb") as handle:
        handle.seek(0, 2)
        size = handle.tell()
        start = max(0, size - max(1, max_bytes))
        handle.seek(start)
        data = handle.read()

    if start:
        _, separator, data = data.partition(b"\n")
        if not separator:
            return

    for raw_line in data.splitlines():
        try:
            yield raw_line.decode("utf-8")
        except UnicodeDecodeError:
            continue


def latest_rollout_terminal_evidence(
    path: Path,
    *,
    max_bytes: int = DEFAULT_ROLLOUT_TAIL_BYTES,
) -> Optional[Dict[str, str]]:
    latest_lifecycle: Optional[Dict[str, str]] = None
    final_messages: Dict[str, str] = {}

    for line in _tail_lines(path, max_bytes):
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(item, dict):
            continue

        payload = item.get("payload")
        if not isinstance(payload, dict):
            continue

        if item.get("type") == "response_item" and payload.get("type") == "message":
            metadata = payload.get("internal_chat_message_metadata_passthrough")
            turn_id = metadata.get("turn_id") if isinstance(metadata, dict) else ""
            if payload.get("role") == "assistant" and payload.get("phase") == "final_answer" and turn_id:
                content = payload.get("content")
                if isinstance(content, list):
                    texts = [
                        str(part.get("text"))
                        for part in content
                        if isinstance(part, dict) and part.get("type") == "output_text" and part.get("text")
                    ]
                    if texts:
                        final_messages[str(turn_id)] = "\n".join(texts).strip()
            continue

        if item.get("type") != "event_msg":
            continue
        event_type = str(payload.get("type") or "")
        if event_type not in {"task_started", *TERMINAL_EVENT_STATUS}:
            continue

        timestamp = parse_timestamp(item.get("timestamp"))
        turn_id = str(payload.get("turn_id") or "")
        if timestamp is None or not turn_id:
            continue
        latest_lifecycle = {
            "event_type": event_type,
            "observed_at": timestamp.isoformat(),
            "turn_id": turn_id,
        }

    if latest_lifecycle is None or latest_lifecycle["event_type"] == "task_started":
        return None

    status, event_name = TERMINAL_EVENT_STATUS[latest_lifecycle["event_type"]]
    latest_lifecycle["status"] = status
    latest_lifecycle["event_name"] = event_name
    latest_lifecycle["last_assistant_message"] = final_messages.get(
        latest_lifecycle["turn_id"], ""
    )
    return latest_lifecycle


def _trusted_transcript_path(session_id: str, session: Dict[str, Any]) -> Optional[Path]:
    raw_path = session.get("transcript_path")
    if not isinstance(raw_path, str) or not raw_path:
        return None
    path = Path(raw_path).expanduser()
    if not (path.stem == session_id or path.stem.endswith(f"-{session_id}")):
        return None

    candidates = [path]
    source_root = next(
        (parent for parent in path.parents if parent.name in {"sessions", "archived_sessions"}),
        None,
    )
    if source_root is not None:
        alternate_name = "archived_sessions" if source_root.name == "sessions" else "sessions"
        candidates.append(source_root.parent / alternate_name / path.name)

    for candidate in candidates:
        if not candidate.is_symlink() and candidate.is_file():
            return candidate
    return None


def reconcile_sessions(
    state_dir: Optional[Path] = None,
    *,
    dry_run: bool = False,
    max_bytes: int = DEFAULT_ROLLOUT_TAIL_BYTES,
) -> Dict[str, Any]:
    resolved = state_dir_path(state_dir)
    if not resolved.exists():
        return {
            "examined_sessions": 0,
            "updated_sessions": [],
            "updated_count": 0,
            "dry_run": dry_run,
        }

    lock = nullcontext() if dry_run else _state_lock(resolved)
    with lock:
        sessions = load_sessions(resolved)
        updated: list[Dict[str, str]] = []
        examined = 0

        for session_id, session in sessions.items():
            if str(session.get("status") or "") not in STALE_ELIGIBLE_STATUSES:
                continue
            transcript_path = _trusted_transcript_path(session_id, session)
            if transcript_path is None:
                continue
            examined += 1
            evidence = latest_rollout_terminal_evidence(transcript_path, max_bytes=max_bytes)
            if evidence is None:
                continue

            evidence_at = parse_timestamp(evidence["observed_at"])
            last_seen_at = parse_timestamp(session.get("last_seen_at"))
            if evidence_at is None or (last_seen_at is not None and evidence_at <= last_seen_at):
                continue

            status = evidence["status"]
            session.update(
                {
                    "last_seen_at": evidence["observed_at"],
                    "last_event_name": evidence["event_name"],
                    "status": status,
                    "display_state": display_state_for_status(status),
                    "display_state_started_at": evidence["observed_at"],
                    "turn_id": evidence["turn_id"],
                    "current_tool": "",
                    "event_count": int(session.get("event_count", 0)) + 1,
                }
            )
            if evidence["last_assistant_message"]:
                session["last_assistant_message"] = evidence["last_assistant_message"][:500]
            updated.append(
                {
                    "session_id": session_id,
                    "status": status,
                    "event_name": evidence["event_name"],
                    "observed_at": evidence["observed_at"],
                }
            )

        if updated and not dry_run:
            save_sessions(sessions, resolved)

    return {
        "examined_sessions": examined,
        "updated_sessions": updated,
        "updated_count": len(updated),
        "dry_run": dry_run,
    }
