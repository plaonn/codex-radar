from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional

from .display_state import sanitize_iso_datetime, sanitize_session_id
from .transcript import redact


TRANSCRIPT_PREVIEW_CONTRACT = "codex-radar.transcript-preview"
TRANSCRIPT_PREVIEW_VERSION = 1
DEFAULT_PREVIEW_LIMIT = 120
MAX_PREVIEW_LIMIT = 200
MAX_MESSAGE_CHARACTERS = 20_000
TEXT_PART_TYPES = {"", "text", "input_text", "output_text", "markdown"}


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _role(value: Any) -> str:
    role = str(value or "").lower()
    if role in {"user", "human"}:
        return "user"
    if role in {"assistant", "codex", "agent"}:
        return "assistant"
    return ""


def _candidate_role(item: Mapping[str, Any]) -> str:
    if isinstance(item.get("role"), str):
        return _role(item.get("role"))
    author = item.get("author")
    if isinstance(author, Mapping):
        return _role(author.get("role"))
    item_type = item.get("type")
    if item_type == "user_message":
        return "user"
    if item_type == "agent_message":
        return "assistant"
    return ""


def _append_text(found: List[str], value: Any) -> None:
    if len(found) >= 8 or not isinstance(value, str):
        return
    text = redact(value).replace("\r\n", "\n").replace("\r", "\n").strip()
    if text:
        found.append(text[:MAX_MESSAGE_CHARACTERS])


def _collect_content(found: List[str], value: Any) -> None:
    if len(found) >= 8:
        return
    if isinstance(value, str):
        _append_text(found, value)
        return
    if isinstance(value, list):
        for child in value:
            _collect_content(found, child)
        return
    if not isinstance(value, Mapping):
        return
    part_type = str(value.get("type") or "")
    if part_type not in TEXT_PART_TYPES:
        return
    for key in ("text", "content", "message"):
        if key in value:
            _collect_content(found, value[key])


def _candidate_messages(item: Mapping[str, Any]) -> Iterable[Mapping[str, Any]]:
    for candidate in (
        item,
        item.get("payload"),
        item.get("message"),
        item.get("entry"),
        item.get("item"),
        item.get("data"),
        item.get("record"),
    ):
        if isinstance(candidate, Mapping):
            yield candidate


def conversation_messages(items: Iterable[Mapping[str, Any]]) -> List[Dict[str, str]]:
    messages: List[Dict[str, str]] = []
    previous: Optional[Dict[str, str]] = None
    for item in items:
        if not isinstance(item, Mapping):
            continue
        for candidate in _candidate_messages(item):
            role = _candidate_role(candidate)
            if not role:
                continue
            texts: List[str] = []
            for key in ("content", "text", "message", "summary"):
                if key in candidate:
                    _collect_content(texts, candidate[key])
            candidate_messages = [{"role": role, "text": text} for text in texts]
            if candidate_messages:
                for message in candidate_messages:
                    if message != previous:
                        messages.append(message)
                        previous = message
                break
    return messages


def build_transcript_preview(
    session_id: str,
    items: Iterable[Mapping[str, Any]],
    *,
    limit: int,
    generated_at: Optional[str] = None,
) -> Dict[str, Any]:
    """Build an explicit, bounded, sanitized preview from decoded JSONL items."""

    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_PREVIEW_LIMIT:
        raise ValueError(f"limit must be between 1 and {MAX_PREVIEW_LIMIT}")
    safe_session_id = sanitize_session_id(session_id)
    if not safe_session_id:
        raise ValueError("session_id must be a safe non-empty identity")
    messages = conversation_messages(items)[-limit:]
    return {
        "contract": TRANSCRIPT_PREVIEW_CONTRACT,
        "version": TRANSCRIPT_PREVIEW_VERSION,
        "generated_at": sanitize_iso_datetime(generated_at) or _utc_now(),
        "session_id": safe_session_id,
        "limit": limit,
        "messages": messages,
    }
