#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INSTALLER_SOURCE = ROOT / "src" / "codex_radar" / "helper_manager.py"
COMPATIBILITY_SOURCE = ROOT / "distribution" / "helper-compatibility.json"
WHEEL_VERSION = re.compile(r"^codex_radar-(?P<version>[^-]+)-.+\.whl$")
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def sha256(path: Path) -> str:
    digest = hashlib.sha256(path.read_bytes())
    return digest.hexdigest()


def _write_reproducible_member(
    archive: zipfile.ZipFile,
    arcname: str,
    content: bytes,
    *,
    executable: bool = False,
) -> None:
    info = zipfile.ZipInfo(arcname, date_time=ZIP_TIMESTAMP)
    info.create_system = 3
    info.compress_type = zipfile.ZIP_DEFLATED
    mode = 0o755 if executable else 0o644
    info.external_attr = ((stat.S_IFREG | mode) & 0xFFFF) << 16
    archive.writestr(info, content, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def build_bundle(wheel: Path, output: Path) -> tuple[Path, Path]:
    match = WHEEL_VERSION.match(wheel.name)
    if not match:
        raise SystemExit(f"expected a codex_radar wheel filename, got: {wheel.name}")
    compatibility = json.loads(COMPATIBILITY_SOURCE.read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as temporary:
        staging = Path(temporary) / f"codex-radar-helper-{match.group('version')}"
        staging.mkdir()
        installed_wheel = staging / wheel.name
        installer = staging / "install-helper.py"
        shutil.copy2(wheel, installed_wheel)
        shutil.copy2(INSTALLER_SOURCE, installer)
        installer.chmod(0o755)
        manifest = {
            **compatibility,
            "runtime_version": match.group("version"),
            "artifacts": [
                {"path": installed_wheel.name, "sha256": sha256(installed_wheel)},
                {"path": installer.name, "sha256": sha256(installer)},
            ],
        }
        (staging / "helper-manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(staging.iterdir()):
                _write_reproducible_member(
                    archive,
                    f"{staging.name}/{path.name}",
                    path.read_bytes(),
                    executable=path.name == "install-helper.py",
                )
    checksum = output.with_suffix(output.suffix + ".sha256")
    checksum.write_text(f"{sha256(output)}  {output.name}\n", encoding="utf-8")
    return output, checksum


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wheel", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    bundle, checksum = build_bundle(args.wheel.resolve(), args.output.resolve())
    print(bundle)
    print(checksum)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
