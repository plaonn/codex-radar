from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Tuple


SECRET_PATTERNS = [
    re.compile(r"\bsk-[A-Za-z0-9_\-]{12,}\b"),
    re.compile(r"\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*['\"]?[^'\"\s,}]+", re.I),
]

TEXT_KEYS = {"text", "message", "content", "last_assistant_message", "summary"}


def redact(text: str) -> str:
    redacted = text
    home = str(Path.home())
    if home and home in redacted:
        redacted = redacted.replace(home, "~")
    for pattern in SECRET_PATTERNS:
        redacted = pattern.sub("[REDACTED]", redacted)
    return redacted


def iter_jsonl(path: Path) -> Iterator[Dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(item, dict):
                yield item


def find_role(item: Any) -> str:
    if not isinstance(item, dict):
        return ""
    role = item.get("role")
    if isinstance(role, str):
        return role
    author = item.get("author")
    if isinstance(author, dict) and isinstance(author.get("role"), str):
        return author["role"]
    item_type = item.get("type") or item.get("event_name") or item.get("hook_event_name")
    return item_type if isinstance(item_type, str) else ""


def collect_texts(item: Any, *, max_texts: int = 4) -> List[str]:
    found: List[str] = []

    def visit(value: Any, key: str = "") -> None:
        if len(found) >= max_texts:
            return
        if isinstance(value, str):
            if key in TEXT_KEYS and value.strip():
                found.append(redact(value.strip()))
            return
        if isinstance(value, list):
            for child in value:
                visit(child, key)
            return
        if isinstance(value, dict):
            for child_key, child_value in value.items():
                visit(child_value, child_key)

    visit(item)
    return found


def skim_transcript(path: Path, limit: int = 30) -> List[Tuple[str, str]]:
    if not path.exists():
        raise FileNotFoundError(path)

    entries: List[Tuple[str, str]] = []
    for item in iter_jsonl(path):
        role = find_role(item) or "entry"
        texts = collect_texts(item)
        for text in texts:
            compact = " ".join(text.split())
            if compact:
                entries.append((role, compact))

    if limit > 0:
        return entries[-limit:]
    return entries


def format_skim(entries: Iterable[Tuple[str, str]], width: int = 100) -> str:
    lines: List[str] = []
    for role, text in entries:
        available = max(20, width - len(role) - 4)
        if len(text) > available:
            text = text[: available - 1].rstrip() + "..."
        lines.append(f"{role:>12}  {text}")
    return os.linesep.join(lines)
