from __future__ import annotations

import os
from pathlib import Path
from typing import Mapping, Optional


def is_windows() -> bool:
    return os.name == "nt"


def windows_local_app_data(
    environ: Optional[Mapping[str, str]] = None,
    *,
    home: Optional[Path] = None,
) -> Path:
    values = os.environ if environ is None else environ
    configured = values.get("LOCALAPPDATA")
    if configured:
        return Path(configured).expanduser()
    return (home or Path.home()) / "AppData" / "Local"


def default_state_dir() -> Path:
    explicit = os.environ.get("CODEX_RADAR_HOME")
    if explicit:
        return Path(explicit).expanduser()
    if is_windows():
        return windows_local_app_data() / "codex-radar" / "state"
    xdg_state = os.environ.get("XDG_STATE_HOME")
    if xdg_state:
        return Path(xdg_state).expanduser() / "codex-radar"
    return Path.home() / ".local" / "state" / "codex-radar"


def default_runtime_root() -> Path:
    if is_windows():
        return windows_local_app_data() / "codex-radar" / "runtime"
    return Path.home() / ".local" / "share" / "codex-radar" / "runtime"


def default_bin_dir() -> Path:
    if is_windows():
        return windows_local_app_data() / "codex-radar" / "bin"
    return Path.home() / ".local" / "bin"


def default_hooks_file() -> Path:
    return Path.home() / ".codex" / "hooks.json"
