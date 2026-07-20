from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Mapping, Optional


CODEX_INTERNAL_PROJECT = "Codex internal"
CODEX_INTERNAL_SUBDIRECTORIES = ("memories",)


def default_codex_home(
    environ: Optional[Mapping[str, str]] = None,
    *,
    home: Optional[Path] = None,
) -> Path:
    values = os.environ if environ is None else environ
    configured = values.get("CODEX_HOME")
    if configured:
        return Path(configured).expanduser()
    return (home or Path.home()) / ".codex"


def _resolved(path: Path) -> Path:
    try:
        return path.expanduser().resolve(strict=False)
    except (OSError, RuntimeError):
        return path.expanduser().absolute()


def is_codex_internal_cwd(
    cwd: Any,
    environ: Optional[Mapping[str, str]] = None,
    *,
    home: Optional[Path] = None,
) -> bool:
    if not isinstance(cwd, str) or not cwd.strip():
        return False
    candidate = _resolved(Path(cwd.strip()))
    codex_home = _resolved(default_codex_home(environ, home=home))
    for subdirectory in CODEX_INTERNAL_SUBDIRECTORIES:
        internal_root = codex_home / subdirectory
        if candidate == internal_root or internal_root in candidate.parents:
            return True
    return False


def classified_project(
    cwd: Any,
    stored_project: Any = "",
    environ: Optional[Mapping[str, str]] = None,
    *,
    home: Optional[Path] = None,
) -> str:
    if is_codex_internal_cwd(cwd, environ, home=home):
        return CODEX_INTERNAL_PROJECT
    if isinstance(stored_project, str) and stored_project:
        return stored_project
    if isinstance(cwd, str) and cwd.strip():
        return Path(cwd.strip()).name
    return ""
