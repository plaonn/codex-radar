from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import re
import shlex
import shutil
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


def default_runtime_root() -> Path:
    return Path.home() / ".local" / "share" / "codex-radar" / "runtime"


def default_bin_dir() -> Path:
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
    if manifest.get("platforms") != ["posix"]:
        raise HelperError("helper bundle is not a supported POSIX bundle")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise HelperError("bundle manifest must list artifacts")
    return manifest


def _check_compatibility(manifest: Dict[str, Any]) -> None:
    if os.name != "posix":
        raise HelperError("this helper bundle supports POSIX hosts only")
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


def _write_launcher(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)


def _atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_bytes(_json_bytes(value))
    os.replace(temporary, path)


def _atomic_symlink(link: Path, target: str) -> None:
    link.parent.mkdir(parents=True, exist_ok=True)
    temporary = link.with_name(f".{link.name}.{uuid.uuid4().hex}.tmp")
    temporary.symlink_to(target)
    os.replace(temporary, link)


def _current_version(root: Path) -> Optional[str]:
    current = root / "current"
    if not current.is_symlink():
        if current.exists():
            raise HelperError(f"runtime current path is not a symlink: {current}")
        return None
    target = Path(os.readlink(current))
    if target.parent != Path("versions"):
        raise HelperError(f"runtime current symlink has an unexpected target: {target}")
    return _safe_runtime_version(target.name)


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


def _preflight_shims(root: Path, bin_dir: Path) -> list[tuple[Path, str]]:
    missing: list[tuple[Path, str]] = []
    for name in ("codex-radar", "codex-radar-hook", "codex-radar-helper"):
        link = bin_dir / name
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
    for link, target in reversed(list(created)):
        try:
            if link.is_symlink() and os.readlink(link) == target:
                link.unlink()
        except OSError:
            pass


def _ensure_shims(root: Path, bin_dir: Path) -> list[tuple[Path, str]]:
    missing = _preflight_shims(root, bin_dir)
    created: list[tuple[Path, str]] = []
    try:
        bin_dir.mkdir(parents=True, exist_ok=True)
        for link, target in missing:
            link.symlink_to(target)
            created.append((link, target))
    except OSError:
        _cleanup_created_shims(created)
        raise
    return created


def _restore_current(root: Path, selected: str, previous: Optional[str]) -> None:
    current = root / "current"
    expected = str(Path("versions") / selected)
    if not current.is_symlink() or os.readlink(current) != expected:
        raise HelperError("cannot safely restore runtime current after persistence failure")
    if previous is None:
        current.unlink()
    else:
        _atomic_symlink(current, str(Path("versions") / previous))


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
            _write_launcher(
                binary / "codex-radar",
                _launcher(python, installed_library, "codex_radar.cli"),
            )
            _write_launcher(
                binary / "codex-radar-hook",
                _launcher(python, installed_library, "codex_radar.hook"),
            )
            _write_launcher(
                binary / "codex-radar-helper",
                _launcher(
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
        _atomic_symlink(root / "current", str(Path("versions") / version))
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
        "hook_command": str(bin_dir / "codex-radar-hook"),
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
        _atomic_symlink(root / "current", str(Path("versions") / target))
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
        link = bin_dir / name
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
    stable = shlex.split(hook_fragment(hook_command)["hooks"][HOOK_EVENTS[0]][0]["hooks"][0]["command"])
    event_checks: Dict[str, str] = {}
    for event in HOOK_EVENTS:
        commands = []
        for entry in _hook_entries(hooks.get(event)):
            command = entry.get("command")
            if not isinstance(command, str):
                continue
            try:
                commands.append(shlex.split(command))
            except ValueError:
                commands.append([])
        if stable in commands:
            event_checks[event] = "stable"
        elif ["codex-radar", "hook"] in commands:
            event_checks[event] = "legacy"
        elif any(command and "codex-radar" in command[0] for command in commands):
            event_checks[event] = "mismatched"
        else:
            event_checks[event] = "missing"
    states = set(event_checks.values())
    if states == {"stable"}:
        code = "ready"
    elif states <= {"legacy"}:
        code = "legacy"
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
        bin_dir / "codex-radar-hook",
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
    command = shlex.quote(str(hook_command.expanduser().resolve()))
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
        found = False
        for group in current_groups:
            if not isinstance(group, dict) or not isinstance(group.get("hooks"), list):
                continue
            for entry in group["hooks"]:
                if not isinstance(entry, dict):
                    continue
                command = str(entry.get("command", "")).strip()
                try:
                    same_stable_command = shlex.split(command) == shlex.split(stable_command)
                except ValueError:
                    same_stable_command = False
                if command == "codex-radar hook" or same_stable_command:
                    entry.update(groups[0]["hooks"][0])
                    found = True
        if not found:
            current_groups.extend(groups)
    return merged


def hook_config_output(hook_command: Path, hooks_file: Optional[Path] = None) -> str:
    fragment = hook_fragment(hook_command)
    if hooks_file is None:
        return _json_bytes(fragment).decode("utf-8")
    hooks_file = hooks_file.expanduser()
    if hooks_file.exists():
        original = hooks_file.read_text(encoding="utf-8")
        try:
            existing = json.loads(original)
        except json.JSONDecodeError as exc:
            raise HelperError(f"invalid hooks JSON: {exc}") from exc
        if not isinstance(existing, dict):
            raise HelperError("existing hooks JSON must be an object")
    else:
        original = "{}\n"
        existing = {}
    proposed = _json_bytes(_merge_hook_config(existing, fragment)).decode("utf-8")
    return "".join(
        difflib.unified_diff(
            original.splitlines(keepends=True),
            proposed.splitlines(keepends=True),
            fromfile=str(hooks_file),
            tofile=f"{hooks_file} (proposed; not written)",
        )
    )


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
            print(hook_config_output(args.bin_dir / "codex-radar-hook", args.hooks_file), end="")
        return 0
    except (HelperError, OSError) as exc:
        print(f"codex-radar-helper: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
