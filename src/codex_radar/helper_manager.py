from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import uuid
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any, Dict, Iterable, Optional

MANIFEST_NAME = "helper-manifest.json"
MANIFEST_SCHEMA_VERSION = 1
STATE_SCHEMA_VERSION = 1
RUNTIME_MARKER = ".codex-radar-runtime.json"
HOOK_EVENTS = (
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PermissionRequest",
    "Stop",
)
_VERSION_PART = re.compile(r"^(\d+)(?:\.(\d+))?(?:\.(\d+))?$")


class HelperError(RuntimeError):
    pass


def is_windows() -> bool:
    return os.name == "nt"


def _windows_local_app_data() -> Path:
    configured = os.environ.get("LOCALAPPDATA")
    if configured:
        return Path(configured).expanduser()
    return Path.home() / "AppData" / "Local"


def default_runtime_root() -> Path:
    if is_windows():
        return _windows_local_app_data() / "codex-radar" / "runtime"
    return Path.home() / ".local" / "share" / "codex-radar" / "runtime"


def default_bin_dir() -> Path:
    if is_windows():
        return _windows_local_app_data() / "codex-radar" / "bin"
    return Path.home() / ".local" / "bin"


def default_hooks_file() -> Path:
    return Path.home() / ".codex" / "hooks.json"


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _manifest_digest(manifest: Dict[str, Any]) -> str:
    return hashlib.sha256(_json_bytes(manifest)).hexdigest()


def _version_tuple(value: str) -> tuple[int, int, int]:
    match = _VERSION_PART.match(value.strip())
    if not match:
        raise HelperError(f"invalid version: {value}")
    return tuple(int(part or 0) for part in match.groups())  # type: ignore[return-value]


def _safe_runtime_version(value: str) -> str:
    version_path = PurePosixPath(value)
    if (
        version_path.is_absolute()
        or len(version_path.parts) != 1
        or version_path.name in {".", ".."}
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]*", version_path.name)
    ):
        raise HelperError("runtime version is not safe for an immutable runtime path")
    return version_path.name


def _load_manifest(bundle_dir: Path) -> Dict[str, Any]:
    path = bundle_dir / MANIFEST_NAME
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise HelperError(f"bundle manifest not found: {path}") from exc
    except OSError as exc:
        raise HelperError(f"bundle manifest is not readable: {path}") from exc
    except json.JSONDecodeError as exc:
        raise HelperError(f"invalid bundle manifest: {exc}") from exc
    if not isinstance(manifest, dict) or manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION:
        raise HelperError("unsupported helper bundle manifest schema")
    for key in ("runtime_version", "python_requires", "platforms", "artifacts", "compatibility"):
        if key not in manifest:
            raise HelperError(f"bundle manifest missing field: {key}")
    if not isinstance(manifest["runtime_version"], str) or not manifest["runtime_version"]:
        raise HelperError("bundle runtime_version must be a non-empty string")
    _safe_runtime_version(manifest["runtime_version"])
    platforms = manifest.get("platforms")
    if (
        not isinstance(platforms, list)
        or not platforms
        or not all(isinstance(item, str) for item in platforms)
        or not set(platforms) <= {"posix", "windows"}
    ):
        raise HelperError("helper bundle has unsupported platforms")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise HelperError("bundle manifest must list artifacts")
    return manifest


def _check_compatibility(manifest: Dict[str, Any]) -> None:
    current_platform = "windows" if is_windows() else "posix"
    if current_platform not in manifest["platforms"]:
        raise HelperError(f"this helper bundle does not support {current_platform} hosts")
    requirement = str(manifest["python_requires"])
    if not requirement.startswith(">="):
        raise HelperError(f"unsupported python_requires value: {requirement}")
    minimum = _version_tuple(requirement[2:])
    running = (sys.version_info.major, sys.version_info.minor, sys.version_info.micro)
    if running < minimum:
        raise HelperError(f"Python {requirement[2:]} or later is required")


def _verified_artifacts(bundle_dir: Path, manifest: Dict[str, Any]) -> list[Path]:
    verified: list[Path] = []
    for artifact in manifest["artifacts"]:
        if not isinstance(artifact, dict):
            raise HelperError("invalid artifact entry")
        relative = artifact.get("path")
        expected = artifact.get("sha256")
        if not isinstance(relative, str) or not isinstance(expected, str):
            raise HelperError("artifact path and sha256 are required")
        pure = PurePosixPath(relative)
        if pure.is_absolute() or ".." in pure.parts or len(pure.parts) != 1:
            raise HelperError(f"unsafe artifact path: {relative}")
        path = bundle_dir / relative
        if path.is_symlink():
            raise HelperError(f"bundle artifact must not be a symlink: {relative}")
        if not path.is_file():
            raise HelperError(f"bundle artifact not found: {relative}")
        actual = _sha256(path)
        if actual != expected.lower():
            raise HelperError(f"checksum mismatch for {relative}: expected {expected}, got {actual}")
        verified.append(path)
    return verified


def _wheel_artifact(paths: Iterable[Path]) -> Path:
    wheels = [path for path in paths if path.suffix == ".whl"]
    if len(wheels) != 1:
        raise HelperError("helper bundle must contain exactly one wheel artifact")
    return wheels[0]


def _safe_extract_wheel(wheel: Path, destination: Path) -> None:
    try:
        with zipfile.ZipFile(wheel) as archive:
            for info in archive.infolist():
                pure = PurePosixPath(info.filename)
                if pure.is_absolute() or ".." in pure.parts:
                    raise HelperError(f"unsafe wheel member: {info.filename}")
                target = destination.joinpath(*pure.parts)
                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
    except zipfile.BadZipFile as exc:
        raise HelperError(f"invalid wheel artifact: {wheel.name}") from exc


def _validate_extracted_runtime(library: Path) -> None:
    required = (
        library / "codex_radar" / "cli.py",
        library / "codex_radar" / "hook.py",
        library / "codex_radar" / "helper_manager.py",
    )
    missing = [str(path.relative_to(library)) for path in required if not path.is_file()]
    if missing:
        raise HelperError(f"wheel is missing helper runtime modules: {', '.join(missing)}")
    wheel_metadata = list(library.glob("*.dist-info/WHEEL"))
    if len(wheel_metadata) != 1:
        raise HelperError("wheel must contain exactly one .dist-info/WHEEL metadata file")
    metadata = wheel_metadata[0].read_text(encoding="utf-8", errors="replace")
    if "Root-Is-Purelib: true" not in metadata:
        raise HelperError("helper runtime wheel must be pure Python")


def _launcher(python: Path, library: Path, module: str, prefix_args: Iterable[str] = ()) -> str:
    command = [str(python), "-m", module, *prefix_args, '"$@"']
    rendered = " ".join('"$@"' if value == '"$@"' else shlex.quote(value) for value in command)
    return f"#!/bin/sh\nPYTHONPATH={shlex.quote(str(library))} exec {rendered}\n"


def _windows_launcher(
    python: Path,
    library: Path,
    module: str,
    prefix_args: Iterable[str] = (),
) -> str:
    command = subprocess.list2cmdline(
        [str(python), "-m", module, *prefix_args]
    )
    return (
        "@echo off\r\n"
        "setlocal\r\n"
        f'set "PYTHONPATH={library}"\r\n'
        f"{command} %*\r\n"
        "exit /b %ERRORLEVEL%\r\n"
    )


def _write_launcher(path: Path, content: str) -> None:
    if is_windows():
        path.write_bytes(content.encode("ascii"))
    else:
        path.write_text(content, encoding="utf-8")
        path.chmod(0o755)


def _atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_bytes(_json_bytes(value))
    os.replace(temporary, path)


def _atomic_bytes(path: Path, content: bytes, *, mode: Optional[int] = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("xb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        if mode is not None:
            temporary.chmod(mode)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _atomic_symlink(link: Path, target: str) -> None:
    link.parent.mkdir(parents=True, exist_ok=True)
    temporary = link.with_name(f".{link.name}.{uuid.uuid4().hex}.tmp")
    temporary.symlink_to(target)
    os.replace(temporary, link)


def _selector_path(root: Path) -> Path:
    return root / "current.json"


def _current_version(root: Path) -> Optional[str]:
    if is_windows():
        selector = _selector_path(root)
        if not selector.exists():
            return None
        try:
            value = json.loads(selector.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise HelperError(f"runtime current selector is invalid: {selector}") from exc
        if not isinstance(value, dict) or value.get("schema_version") != STATE_SCHEMA_VERSION:
            raise HelperError(f"runtime current selector is invalid: {selector}")
        version = value.get("runtime_version")
        if not isinstance(version, str):
            raise HelperError(f"runtime current selector is invalid: {selector}")
        return _safe_runtime_version(version)
    current = root / "current"
    if not current.is_symlink():
        if current.exists():
            raise HelperError(f"runtime current path is not a symlink: {current}")
        return None
    target = Path(os.readlink(current))
    if target.parent != Path("versions"):
        raise HelperError(f"runtime current symlink has an unexpected target: {target}")
    return _safe_runtime_version(target.name)


def _select_current(root: Path, version: str) -> None:
    if is_windows():
        _atomic_json(
            _selector_path(root),
            {"schema_version": STATE_SCHEMA_VERSION, "runtime_version": version},
        )
    else:
        _atomic_symlink(root / "current", str(Path("versions") / version))


def _remove_current(root: Path) -> None:
    path = _selector_path(root) if is_windows() else root / "current"
    if path.exists() or path.is_symlink():
        path.unlink()


def _load_state(root: Path) -> Dict[str, Any]:
    path = root / "install-state.json"
    if not path.exists():
        return {"schema_version": STATE_SCHEMA_VERSION, "history": []}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HelperError(f"invalid install state: {path}") from exc
    if not isinstance(value, dict) or value.get("schema_version") != STATE_SCHEMA_VERSION:
        raise HelperError("unsupported install state schema")
    if not isinstance(value.get("history"), list):
        raise HelperError("invalid install state history")
    return value


def _record_switch(
    root: Path,
    version: str,
    previous: Optional[str],
    state: Optional[Dict[str, Any]] = None,
) -> None:
    state = dict(state if state is not None else _load_state(root))
    history = [str(item) for item in state["history"] if isinstance(item, str) and item != version]
    if previous and previous != version:
        history.insert(0, previous)
    state.update({"current": version, "history": history})
    _atomic_json(root / "install-state.json", state)


def _command_path(bin_dir: Path, name: str) -> Path:
    return bin_dir / f"{name}.cmd" if is_windows() else bin_dir / name


def _windows_stable_shim(root: Path, bin_dir: Path, name: str) -> str:
    dispatcher = root / "current-dispatch.py"
    python = Path(sys.executable).resolve()
    command = subprocess.list2cmdline([str(python), str(dispatcher), name, str(bin_dir)])
    return f"@echo off\r\n{command} %*\r\nexit /b %ERRORLEVEL%\r\n"


def _windows_dispatcher() -> str:
    return (
        "from __future__ import annotations\n"
        "import json\n"
        "import os\n"
        "import subprocess\n"
        "import sys\n"
        "from pathlib import Path\n"
        "MODULES = {\n"
        "    'codex-radar': 'codex_radar.cli',\n"
        "    'codex-radar-hook': 'codex_radar.hook',\n"
        "    'codex-radar-helper': 'codex_radar.helper_manager',\n"
        "}\n"
        "root = Path(__file__).resolve().parent\n"
        "bin_dir = Path(sys.argv[2])\n"
        "selected = json.loads((root / 'current.json').read_text(encoding='utf-8'))['runtime_version']\n"
        "library = root / 'versions' / selected / 'lib'\n"
        "env = dict(os.environ)\n"
        "env['PYTHONPATH'] = str(library)\n"
        "args = [sys.executable, '-m', MODULES[sys.argv[1]]]\n"
        "if sys.argv[1] == 'codex-radar-helper':\n"
        "    args.extend(['--root', str(root), '--bin-dir', str(bin_dir)])\n"
        "args.extend(sys.argv[3:])\n"
        "raise SystemExit(subprocess.call(args, env=env))\n"
    )


def _preflight_shims(root: Path, bin_dir: Path) -> list[tuple[Path, str]]:
    missing: list[tuple[Path, str]] = []
    for name in ("codex-radar", "codex-radar-hook", "codex-radar-helper"):
        link = _command_path(bin_dir, name)
        if is_windows():
            expected = _windows_stable_shim(root, bin_dir, name)
            if link.exists():
                try:
                    if link.read_bytes() == expected.encode("ascii"):
                        continue
                except OSError:
                    pass
                raise HelperError(f"refusing to replace existing command shim: {link}")
            missing.append((link, expected))
            continue
        target = str(root / "current" / "bin" / name)
        if link.exists() and not link.is_symlink():
            raise HelperError(f"refusing to replace existing non-symlink: {link}")
        if link.is_symlink():
            if os.readlink(link) == target:
                continue
            raise HelperError(f"refusing to replace existing symlink with another target: {link}")
        missing.append((link, target))
    return missing


def _cleanup_created_shims(created: Iterable[tuple[Path, str]]) -> None:
    for link, expected in reversed(list(created)):
        try:
            if (
                is_windows()
                and link.is_file()
                and link.read_bytes() == expected.encode("ascii")
            ):
                link.unlink()
            elif link.is_symlink() and os.readlink(link) == expected:
                link.unlink()
        except OSError:
            pass


def _ensure_shims(root: Path, bin_dir: Path) -> list[tuple[Path, str]]:
    missing = _preflight_shims(root, bin_dir)
    created: list[tuple[Path, str]] = []
    try:
        bin_dir.mkdir(parents=True, exist_ok=True)
        if is_windows():
            dispatcher = root / "current-dispatch.py"
            expected_dispatcher = _windows_dispatcher()
            if dispatcher.exists():
                if dispatcher.read_bytes() != expected_dispatcher.encode("ascii"):
                    raise HelperError(f"refusing to replace existing dispatcher: {dispatcher}")
            else:
                dispatcher.write_bytes(expected_dispatcher.encode("ascii"))
            for link, content in missing:
                link.write_bytes(content.encode("ascii"))
                created.append((link, content))
        else:
            for link, target in missing:
                link.symlink_to(target)
                created.append((link, target))
    except OSError:
        _cleanup_created_shims(created)
        raise
    return created


def _restore_current(root: Path, selected: str, previous: Optional[str]) -> None:
    if _current_version(root) != selected:
        raise HelperError("cannot safely restore runtime current after persistence failure")
    if previous is None:
        _remove_current(root)
    else:
        _select_current(root, previous)


def install_bundle(bundle_dir: Path, root: Path, bin_dir: Path) -> Dict[str, Any]:
    bundle_dir = bundle_dir.expanduser().resolve()
    root = root.expanduser().resolve()
    bin_dir = bin_dir.expanduser().resolve()
    manifest = _load_manifest(bundle_dir)
    _check_compatibility(manifest)
    artifacts = _verified_artifacts(bundle_dir, manifest)
    wheel = _wheel_artifact(artifacts)
    version = _safe_runtime_version(str(manifest["runtime_version"]))
    versions = root / "versions"
    destination = versions / version
    digest = _manifest_digest(manifest)
    root.mkdir(parents=True, exist_ok=True)
    versions.mkdir(parents=True, exist_ok=True)
    state = _load_state(root)
    previous = _current_version(root)
    _preflight_shims(root, bin_dir)

    if destination.is_symlink():
        raise HelperError(f"immutable runtime version must not be a symlink: {destination}")
    if destination.exists():
        marker_path = destination / RUNTIME_MARKER
        try:
            marker = json.loads(marker_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise HelperError(f"immutable runtime already exists without a valid marker: {destination}") from exc
        if marker.get("manifest_sha256") != digest:
            raise HelperError(f"immutable runtime version already exists with different contents: {version}")
    else:
        staging = versions / f".{version}.install-{uuid.uuid4().hex}"
        try:
            library = staging / "lib"
            binary = staging / "bin"
            installed_library = destination / "lib"
            library.mkdir(parents=True)
            binary.mkdir(parents=True)
            _safe_extract_wheel(wheel, library)
            _validate_extracted_runtime(library)
            python = Path(sys.executable).resolve()
            launcher = _windows_launcher if is_windows() else _launcher
            suffix = ".cmd" if is_windows() else ""
            _write_launcher(
                binary / f"codex-radar{suffix}",
                launcher(python, installed_library, "codex_radar.cli"),
            )
            _write_launcher(
                binary / f"codex-radar-hook{suffix}",
                launcher(python, installed_library, "codex_radar.hook"),
            )
            _write_launcher(
                binary / f"codex-radar-helper{suffix}",
                launcher(
                    python,
                    installed_library,
                    "codex_radar.helper_manager",
                    ("--root", str(root), "--bin-dir", str(bin_dir)),
                ),
            )
            marker = {
                "schema_version": MANIFEST_SCHEMA_VERSION,
                "runtime_version": version,
                "manifest_sha256": digest,
                "python": str(python),
                "python_requires": manifest["python_requires"],
                "compatibility": manifest["compatibility"],
            }
            (staging / RUNTIME_MARKER).write_bytes(_json_bytes(marker))
            os.replace(staging, destination)
        except BaseException:
            shutil.rmtree(staging, ignore_errors=True)
            raise

    created_shims = _ensure_shims(root, bin_dir)
    try:
        _select_current(root, version)
        try:
            _record_switch(root, version, previous, state)
        except BaseException:
            _restore_current(root, version, previous)
            raise
    except BaseException:
        _cleanup_created_shims(created_shims)
        raise
    return {
        "action": "installed" if previous != version else "already-current",
        "runtime_version": version,
        "previous_version": previous,
        "runtime_root": str(root),
        "hook_command": str(_command_path(bin_dir, "codex-radar-hook")),
        "compatibility": manifest["compatibility"],
    }


def rollback_runtime(root: Path, bin_dir: Path, version: Optional[str] = None) -> Dict[str, Any]:
    root = root.expanduser().resolve()
    bin_dir = bin_dir.expanduser().resolve()
    current = _current_version(root)
    if current is None:
        raise HelperError("no current helper runtime is installed")
    state = _load_state(root)
    candidates = [str(item) for item in state["history"] if isinstance(item, str)]
    target = version or next((item for item in candidates if item != current), None)
    if not target:
        raise HelperError("no previous helper runtime is available for rollback")
    target = _safe_runtime_version(target)
    destination = root / "versions" / target
    if destination.is_symlink():
        raise HelperError(f"rollback runtime must not be a symlink: {target}")
    if not destination.is_dir() or not (destination / RUNTIME_MARKER).is_file():
        raise HelperError(f"rollback runtime is not installed: {target}")
    _preflight_shims(root, bin_dir)
    created_shims = _ensure_shims(root, bin_dir)
    try:
        _select_current(root, target)
        try:
            _record_switch(root, target, current, state)
        except BaseException:
            _restore_current(root, target, current)
            raise
    except BaseException:
        _cleanup_created_shims(created_shims)
        raise
    return {"action": "rolled-back", "runtime_version": target, "previous_version": current}


def installed_status(root: Path) -> Dict[str, Any]:
    root = root.expanduser().resolve()
    versions_dir = root / "versions"
    versions = []
    if versions_dir.is_dir():
        versions = sorted(
            item.name
            for item in versions_dir.iterdir()
            if item.is_dir() and not item.name.startswith(".") and (item / RUNTIME_MARKER).is_file()
        )
    return {"runtime_root": str(root), "current": _current_version(root), "versions": versions}


def _shim_diagnostics(root: Path, bin_dir: Path) -> Dict[str, str]:
    checks: Dict[str, str] = {}
    for name in ("codex-radar", "codex-radar-hook", "codex-radar-helper"):
        link = _command_path(bin_dir, name)
        if is_windows():
            expected = _windows_stable_shim(root, bin_dir, name)
            if not link.exists():
                checks[name] = "missing"
            else:
                try:
                    checks[name] = (
                        "ready"
                        if link.read_bytes() == expected.encode("ascii")
                        else "wrong_content"
                    )
                except OSError:
                    checks[name] = "unreadable"
            continue
        expected = str(root / "current" / "bin" / name)
        if not link.is_symlink():
            checks[name] = "not_symlink" if link.exists() else "missing"
            continue
        try:
            checks[name] = "ready" if os.readlink(link) == expected else "wrong_target"
        except OSError:
            checks[name] = "unreadable"
    return checks


def _runtime_diagnostics(root: Path) -> tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    try:
        current = _current_version(root)
    except HelperError:
        return {"code": "current_invalid"}, None
    if current is None:
        return {"code": "current_missing"}, None
    destination = root / "versions" / current
    if destination.is_symlink():
        return {"code": "runtime_symlink", "version": current}, None
    marker_path = destination / RUNTIME_MARKER
    if not destination.is_dir() or not marker_path.is_file() or marker_path.is_symlink():
        return {"code": "runtime_missing", "version": current}, None
    try:
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {"code": "marker_invalid", "version": current}, None
    if not isinstance(marker, dict) or marker.get("schema_version") != MANIFEST_SCHEMA_VERSION:
        return {"code": "marker_invalid", "version": current}, None
    if marker.get("runtime_version") != current:
        return {"code": "runtime_version_mismatch", "version": current}, marker
    digest = marker.get("manifest_sha256")
    if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        return {"code": "marker_invalid", "version": current}, marker
    return {"code": "ready", "version": current}, marker


def _compatibility_diagnostics(marker: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if marker is None:
        return {"code": "runtime_unavailable"}
    requirement = marker.get("python_requires")
    compatibility = marker.get("compatibility")
    if not isinstance(requirement, str) or not requirement.startswith(">="):
        return {"code": "metadata_incomplete"}
    if not isinstance(compatibility, dict) or not isinstance(
        compatibility.get("vscode_extension"), dict
    ):
        return {"code": "metadata_incomplete"}
    try:
        minimum = _version_tuple(requirement[2:])
    except HelperError:
        return {"code": "metadata_invalid"}
    running = (sys.version_info.major, sys.version_info.minor, sys.version_info.micro)
    if running < minimum:
        return {"code": "python_incompatible", "python_requires": requirement}
    python_path = marker.get("python")
    if not isinstance(python_path, str) or not python_path or not Path(python_path).is_file():
        return {"code": "python_missing", "python_requires": requirement}
    return {
        "code": "compatible",
        "python_requires": requirement,
        "extension_check": "local_range_only",
    }


def _hook_entries(value: Any) -> Iterable[Dict[str, Any]]:
    if not isinstance(value, list):
        return
    for group in value:
        if not isinstance(group, dict) or not isinstance(group.get("hooks"), list):
            continue
        for entry in group["hooks"]:
            if isinstance(entry, dict):
                yield entry


def _split_command(command: str) -> list[str]:
    values = shlex.split(command, posix=not is_windows())
    if is_windows():
        return [value[1:-1] if len(value) >= 2 and value[0] == value[-1] == '"' else value for value in values]
    return values


def _radar_hook_kind(command: str, stable: list[str]) -> Optional[str]:
    try:
        parsed = _split_command(command)
    except ValueError:
        return None
    if parsed == stable:
        return "stable"
    if parsed == ["codex-radar", "hook"]:
        return "legacy"
    if not parsed:
        return None
    executable_name = parsed[0].replace("\\", "/").rsplit("/", 1)[-1].lower()
    if executable_name in {"codex-radar-hook", "codex-radar-hook.cmd"}:
        return "mismatched"
    return None


def _hook_wiring_diagnostics(hooks_file: Path, hook_command: Path) -> Dict[str, Any]:
    if hooks_file.is_symlink():
        return {"code": "hooks_symlink", "events": {event: "unknown" for event in HOOK_EVENTS}}
    if not hooks_file.exists():
        return {"code": "hooks_missing", "events": {event: "missing" for event in HOOK_EVENTS}}
    try:
        payload = json.loads(hooks_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {"code": "hooks_invalid", "events": {event: "unknown" for event in HOOK_EVENTS}}
    hooks = payload.get("hooks") if isinstance(payload, dict) else None
    if not isinstance(hooks, dict):
        return {"code": "hooks_invalid", "events": {event: "unknown" for event in HOOK_EVENTS}}
    stable = _split_command(
        hook_fragment(hook_command)["hooks"][HOOK_EVENTS[0]][0]["hooks"][0]["command"]
    )
    event_checks: Dict[str, str] = {}
    for event in HOOK_EVENTS:
        kinds = []
        for entry in _hook_entries(hooks.get(event)):
            command = entry.get("command")
            if not isinstance(command, str):
                continue
            kind = _radar_hook_kind(command, stable)
            if kind:
                kinds.append(kind)
        if len(kinds) > 1:
            event_checks[event] = "duplicate"
        elif kinds == ["stable"]:
            event_checks[event] = "stable"
        elif kinds == ["legacy"]:
            event_checks[event] = "legacy"
        elif kinds == ["mismatched"]:
            event_checks[event] = "mismatched"
        else:
            event_checks[event] = "missing"
    states = set(event_checks.values())
    if states == {"stable"}:
        code = "ready"
    elif states <= {"legacy"}:
        code = "legacy"
    elif "duplicate" in states:
        code = "duplicate"
    elif "mismatched" in states:
        code = "mismatched"
    else:
        code = "incomplete"
    return {"code": code, "events": event_checks}


def diagnose_helper(
    root: Path,
    bin_dir: Path,
    hooks_file: Optional[Path] = None,
) -> Dict[str, Any]:
    """Return path-free, read-only helper and hook wiring diagnostics."""

    root = root.expanduser().resolve()
    bin_dir = bin_dir.expanduser().resolve()
    selected_hooks = (hooks_file or default_hooks_file()).expanduser()
    runtime, marker = _runtime_diagnostics(root)
    shims = _shim_diagnostics(root, bin_dir)
    compatibility = _compatibility_diagnostics(marker)
    hook_wiring = _hook_wiring_diagnostics(
        selected_hooks,
        _command_path(bin_dir, "codex-radar-hook"),
    )
    ready = (
        runtime["code"] == "ready"
        and set(shims.values()) == {"ready"}
        and compatibility["code"] == "compatible"
        and hook_wiring["code"] == "ready"
    )
    return {
        "schema_version": 1,
        "status": "ready" if ready else "issues",
        "runtime": runtime,
        "shims": shims,
        "compatibility": compatibility,
        "hook_wiring": hook_wiring,
    }


def hook_fragment(hook_command: Path) -> Dict[str, Any]:
    resolved = str(hook_command.expanduser().resolve())
    command = subprocess.list2cmdline([resolved]) if is_windows() else shlex.quote(resolved)
    hooks: Dict[str, Any] = {}
    for event in HOOK_EVENTS:
        entry: Dict[str, Any] = {"type": "command", "command": command, "timeout": 5}
        if event == "SessionStart":
            entry["statusMessage"] = "Indexing Codex session"
        elif event == "PermissionRequest":
            entry["statusMessage"] = "Codex Radar noticed an approval request"
        hooks[event] = [{"hooks": [entry]}]
    return {"hooks": hooks}


def _merge_hook_config(existing: Dict[str, Any], fragment: Dict[str, Any]) -> Dict[str, Any]:
    merged = json.loads(json.dumps(existing))
    existing_hooks = merged.setdefault("hooks", {})
    if not isinstance(existing_hooks, dict):
        raise HelperError("existing hooks.json has a non-object hooks field")
    for event, groups in fragment["hooks"].items():
        current_groups = existing_hooks.setdefault(event, [])
        if not isinstance(current_groups, list):
            raise HelperError(f"existing hooks.json field hooks.{event} is not an array")
        stable_command = groups[0]["hooks"][0]["command"]
        stable = _split_command(stable_command)
        retained_groups = []
        for group in current_groups:
            if not isinstance(group, dict) or not isinstance(group.get("hooks"), list):
                raise HelperError(f"existing hooks.json field hooks.{event} has an invalid hook group")
            retained_entries = []
            for entry in group["hooks"]:
                if not isinstance(entry, dict):
                    raise HelperError(f"existing hooks.json field hooks.{event} has an invalid hook entry")
                command = entry.get("command")
                kind = _radar_hook_kind(command, stable) if isinstance(command, str) else None
                if not kind:
                    retained_entries.append(entry)
            retained_group = dict(group)
            retained_group["hooks"] = retained_entries
            if retained_entries or set(retained_group) != {"hooks"}:
                retained_groups.append(retained_group)
        retained_groups.extend(groups)
        existing_hooks[event] = retained_groups
    return merged


def _read_hook_config(hooks_file: Path) -> tuple[bytes, Dict[str, Any]]:
    if hooks_file.is_symlink():
        raise HelperError("hooks file must not be a symlink")
    if not hooks_file.exists():
        return b"", {}
    if not hooks_file.is_file():
        raise HelperError("hooks file must be a regular file")
    try:
        original = hooks_file.read_bytes()
        existing = json.loads(original.decode("utf-8"))
    except UnicodeDecodeError as exc:
        raise HelperError("existing hooks JSON must be UTF-8") from exc
    except json.JSONDecodeError as exc:
        raise HelperError(f"invalid hooks JSON: {exc}") from exc
    if not isinstance(existing, dict):
        raise HelperError("existing hooks JSON must be an object")
    return original, existing


def hook_config_output(hook_command: Path, hooks_file: Optional[Path] = None) -> str:
    fragment = hook_fragment(hook_command)
    if hooks_file is None:
        return _json_bytes(fragment).decode("utf-8")
    hooks_file = hooks_file.expanduser()
    original_bytes, existing = _read_hook_config(hooks_file)
    original = original_bytes.decode("utf-8") if original_bytes else "{}\n"
    proposed = _json_bytes(_merge_hook_config(existing, fragment)).decode("utf-8")
    return "".join(
        difflib.unified_diff(
            original.splitlines(keepends=True),
            proposed.splitlines(keepends=True),
            fromfile=str(hooks_file),
            tofile=f"{hooks_file} (proposed; not written)",
        )
    )


def apply_hook_config(hook_command: Path, hooks_file: Path) -> Dict[str, Any]:
    hooks_file = hooks_file.expanduser()
    original, existing = _read_hook_config(hooks_file)
    proposed = _merge_hook_config(existing, hook_fragment(hook_command))
    if existing == proposed:
        wiring = _hook_wiring_diagnostics(hooks_file, hook_command)
        if wiring["code"] != "ready":
            raise HelperError("unchanged hook config did not validate as ready")
        return {"action": "unchanged", "backup": None, "hook_wiring": wiring}

    proposed_bytes = _json_bytes(proposed)
    mode = hooks_file.stat().st_mode & 0o777 if original else None
    backup: Optional[Path] = None
    if original:
        backup = hooks_file.with_name(
            f"{hooks_file.name}.codex-radar-backup-{uuid.uuid4().hex}.json"
        )
        with backup.open("xb") as handle:
            handle.write(original)
            handle.flush()
            os.fsync(handle.fileno())
        if mode is not None:
            backup.chmod(mode)

    current, _ = _read_hook_config(hooks_file)
    if current != original:
        if backup and backup.exists():
            backup.unlink()
        raise HelperError("hooks file changed while preparing the update")

    try:
        _atomic_bytes(hooks_file, proposed_bytes, mode=mode)
        written, readback = _read_hook_config(hooks_file)
        wiring = _hook_wiring_diagnostics(hooks_file, hook_command)
        if written != proposed_bytes or readback != proposed or wiring["code"] != "ready":
            raise HelperError("written hook config failed readback validation")
    except Exception:
        if original:
            _atomic_bytes(hooks_file, original, mode=mode)
        elif hooks_file.exists():
            hooks_file.unlink()
        raise

    return {
        "action": "applied",
        "backup": str(backup) if backup else None,
        "hook_wiring": wiring,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="codex-radar-helper")
    parser.add_argument("--root", type=Path, default=default_runtime_root())
    parser.add_argument("--bin-dir", type=Path, default=default_bin_dir())
    subparsers = parser.add_subparsers(dest="command", required=True)
    install = subparsers.add_parser("install", help="Verify and install an extracted helper bundle")
    install.add_argument("bundle_dir", type=Path, nargs="?", default=Path.cwd())
    rollback = subparsers.add_parser("rollback", help="Atomically select a retained runtime")
    rollback.add_argument("version", nargs="?")
    subparsers.add_parser("status", help="List installed helper runtimes")
    diagnose = subparsers.add_parser("diagnose", help="Inspect helper runtime and hook wiring")
    diagnose.add_argument("--hooks-file", type=Path)
    hook_config = subparsers.add_parser("hook-config", help="Print hook fragment or a no-write diff")
    hook_config.add_argument("--hooks-file", type=Path)
    hook_config.add_argument(
        "--apply",
        action="store_true",
        help="Explicitly back up, normalize, atomically write, and validate hooks.json",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "install":
            result = install_bundle(args.bundle_dir, args.root, args.bin_dir)
            print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        elif args.command == "rollback":
            result = rollback_runtime(args.root, args.bin_dir, args.version)
            print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        elif args.command == "status":
            print(json.dumps(installed_status(args.root), ensure_ascii=False, indent=2, sort_keys=True))
        elif args.command == "diagnose":
            print(
                json.dumps(
                    diagnose_helper(args.root, args.bin_dir, args.hooks_file),
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                )
            )
        elif args.command == "hook-config":
            hook_command = _command_path(args.bin_dir, "codex-radar-hook")
            if args.apply:
                print(
                    json.dumps(
                        apply_hook_config(
                            hook_command,
                            args.hooks_file or default_hooks_file(),
                        ),
                        ensure_ascii=False,
                        indent=2,
                        sort_keys=True,
                    )
                )
            else:
                print(
                    hook_config_output(
                        hook_command,
                        args.hooks_file,
                    ),
                    end="",
                )
        return 0
    except (HelperError, OSError) as exc:
        print(f"codex-radar-helper: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
