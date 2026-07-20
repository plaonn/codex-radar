import hashlib
import io
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from typing import Optional
from unittest import mock

from codex_radar.helper_manager import (
    HelperError,
    apply_hook_config,
    diagnose_helper,
    hook_fragment,
    hook_config_output,
    install_bundle,
    installed_status,
    main,
    rollback_runtime,
)
from codex_radar.platform_paths import windows_local_app_data


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _fake_bundle(base: Path, version: str, *, marker: Optional[str] = None) -> Path:
    bundle = base / f"bundle-{version}-{marker or 'default'}"
    bundle.mkdir()
    wheel = bundle / f"codex_radar-{version}-py3-none-any.whl"
    with zipfile.ZipFile(wheel, "w") as archive:
        archive.writestr("codex_radar/__init__.py", "")
        archive.writestr(
            "codex_radar/hook.py",
            "import sys\n"
            f"def main():\n    sys.stdout.write('{marker or version}')\n    return 0\n"
            "if __name__ == '__main__': raise SystemExit(main())\n",
        )
        archive.writestr(
            "codex_radar/cli.py",
            "import sys\n"
            f"def main():\n    sys.stdout.write('cli-{marker or version}')\n    return 0\n"
            "if __name__ == '__main__': raise SystemExit(main())\n",
        )
        archive.writestr(
            "codex_radar/helper_manager.py",
            "def main(): return 0\n"
            "if __name__ == '__main__': raise SystemExit(main())\n",
        )
        archive.writestr(
            f"codex_radar-{version}.dist-info/WHEEL",
            "Wheel-Version: 1.0\nGenerator: test\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
        )
    manifest = {
        "schema_version": 1,
        "runtime_version": version,
        "python_requires": ">=3.9",
        "platforms": ["posix", "windows"],
        "compatibility": {
            "vscode_extension": {"minimum": "0.4.3", "maximum_exclusive": "0.5.0"}
        },
        "artifacts": [{"path": wheel.name, "sha256": _sha256(wheel)}],
    }
    (bundle / "helper-manifest.json").write_text(
        json.dumps(manifest), encoding="utf-8"
    )
    return bundle


@unittest.skipIf(os.name == "nt", "POSIX helper lifecycle regression runs on ubuntu CI")
class HelperManagerTests(unittest.TestCase):
    def test_install_upgrade_and_rollback_keep_stable_hook_shim(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "runtime"
            bin_dir = base / "bin"
            first = _fake_bundle(base, "1.0.0")
            second = _fake_bundle(base, "1.1.0")

            first_result = install_bundle(first, root, bin_dir)
            stable_target = os.readlink(bin_dir / "codex-radar-hook")
            second_result = install_bundle(second, root, bin_dir)

            self.assertEqual("1.0.0", first_result["runtime_version"])
            self.assertEqual("1.0.0", second_result["previous_version"])
            self.assertEqual(stable_target, os.readlink(bin_dir / "codex-radar-hook"))
            self.assertEqual("versions/1.1.0", os.readlink(root / "current"))
            self.assertEqual(["1.0.0", "1.1.0"], installed_status(root)["versions"])
            executed = subprocess.run(
                [str(bin_dir / "codex-radar-hook")],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(0, executed.returncode)
            self.assertEqual("1.1.0", executed.stdout)

            result = rollback_runtime(root, bin_dir)
            self.assertEqual("1.0.0", result["runtime_version"])
            self.assertEqual("versions/1.0.0", os.readlink(root / "current"))
            rolled_back = subprocess.run(
                [str(bin_dir / "codex-radar-hook")],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual("1.0.0", rolled_back.stdout)

    def test_checksum_mismatch_fails_before_runtime_switch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            bundle = _fake_bundle(base, "1.0.0")
            wheel = next(bundle.glob("*.whl"))
            wheel.write_bytes(wheel.read_bytes() + b"tampered")

            with self.assertRaisesRegex(HelperError, "checksum mismatch"):
                install_bundle(bundle, base / "runtime", base / "bin")

            self.assertFalse((base / "runtime" / "current").exists())

    def test_immutable_version_rejects_different_bundle_contents(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "runtime"
            bin_dir = base / "bin"
            install_bundle(_fake_bundle(base, "1.0.0", marker="one"), root, bin_dir)

            with self.assertRaisesRegex(HelperError, "different contents"):
                install_bundle(_fake_bundle(base, "1.0.0", marker="two"), root, bin_dir)

            self.assertEqual("versions/1.0.0", os.readlink(root / "current"))

    def test_existing_non_symlink_is_not_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            bin_dir = base / "bin"
            bin_dir.mkdir()
            existing = bin_dir / "codex-radar-hook"
            existing.write_text("owned by user", encoding="utf-8")

            with self.assertRaisesRegex(HelperError, "refusing to replace"):
                install_bundle(_fake_bundle(base, "1.0.0"), base / "runtime", bin_dir)

            self.assertEqual("owned by user", existing.read_text(encoding="utf-8"))
            self.assertFalse((bin_dir / "codex-radar").exists())
            self.assertFalse((bin_dir / "codex-radar-hook").is_symlink())

    def test_shim_preflight_prevents_partial_creation_when_last_name_collides(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            bin_dir = base / "bin"
            bin_dir.mkdir()
            (bin_dir / "codex-radar-helper").write_text("owned", encoding="utf-8")

            with self.assertRaisesRegex(HelperError, "refusing to replace"):
                install_bundle(_fake_bundle(base, "1.0.0"), base / "runtime", bin_dir)

            self.assertFalse((bin_dir / "codex-radar").exists())
            self.assertFalse((bin_dir / "codex-radar-hook").exists())

    def test_shim_creation_failure_removes_only_new_shims(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            bin_dir = base / "bin"
            real_symlink_to = Path.symlink_to

            def flaky_symlink_to(path: Path, target: str, *args: object, **kwargs: object) -> None:
                if path.name == "codex-radar-hook":
                    raise OSError("simulated shim failure")
                real_symlink_to(path, target, *args, **kwargs)

            with mock.patch.object(Path, "symlink_to", new=flaky_symlink_to):
                with self.assertRaisesRegex(OSError, "simulated shim failure"):
                    install_bundle(_fake_bundle(base, "1.0.0"), base / "runtime", bin_dir)

            self.assertEqual([], list(bin_dir.iterdir()))

    def test_corrupt_install_state_fails_before_switching_current(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "runtime"
            bin_dir = base / "bin"
            install_bundle(_fake_bundle(base, "1.0.0"), root, bin_dir)
            (root / "install-state.json").write_text("{broken", encoding="utf-8")

            with self.assertRaisesRegex(HelperError, "invalid install state"):
                install_bundle(_fake_bundle(base, "1.1.0"), root, bin_dir)

            self.assertEqual("versions/1.0.0", os.readlink(root / "current"))

    def test_state_persistence_failure_restores_previous_current(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "runtime"
            bin_dir = base / "bin"
            install_bundle(_fake_bundle(base, "1.0.0"), root, bin_dir)

            with mock.patch(
                "codex_radar.helper_manager._atomic_json",
                side_effect=OSError("simulated persistence failure"),
            ):
                with self.assertRaisesRegex(OSError, "simulated persistence failure"):
                    install_bundle(_fake_bundle(base, "1.1.0"), root, bin_dir)

            self.assertEqual("versions/1.0.0", os.readlink(root / "current"))

    def test_rollback_persistence_failure_restores_selected_current(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "runtime"
            bin_dir = base / "bin"
            install_bundle(_fake_bundle(base, "1.0.0"), root, bin_dir)
            install_bundle(_fake_bundle(base, "1.1.0"), root, bin_dir)

            with mock.patch(
                "codex_radar.helper_manager._atomic_json",
                side_effect=OSError("simulated rollback persistence failure"),
            ):
                with self.assertRaisesRegex(OSError, "simulated rollback persistence failure"):
                    rollback_runtime(root, bin_dir, "1.0.0")

            self.assertEqual("versions/1.1.0", os.readlink(root / "current"))

    def test_first_install_persistence_failure_removes_current_and_new_shims(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "runtime"
            bin_dir = base / "bin"

            with mock.patch(
                "codex_radar.helper_manager._atomic_json",
                side_effect=OSError("simulated persistence failure"),
            ):
                with self.assertRaisesRegex(OSError, "simulated persistence failure"):
                    install_bundle(_fake_bundle(base, "1.0.0"), root, bin_dir)

            self.assertFalse((root / "current").exists())
            self.assertEqual([], list(bin_dir.iterdir()))

    def test_python_compatibility_is_checked(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            bundle = _fake_bundle(base, "1.0.0")
            manifest_path = bundle / "helper-manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["python_requires"] = ">=99.0"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            with self.assertRaisesRegex(HelperError, "Python 99.0"):
                install_bundle(bundle, base / "runtime", base / "bin")

    def test_rollback_rejects_unsafe_version_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "runtime"
            bin_dir = base / "bin"
            install_bundle(_fake_bundle(base, "1.0.0"), root, bin_dir)

            with self.assertRaisesRegex(HelperError, "not safe"):
                rollback_runtime(root, bin_dir, "../../outside")

    def test_bundle_artifact_symlink_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            bundle = _fake_bundle(base, "1.0.0")
            wheel = next(bundle.glob("*.whl"))
            external = base / "external.whl"
            wheel.replace(external)
            wheel.symlink_to(external)

            with self.assertRaisesRegex(HelperError, "must not be a symlink"):
                install_bundle(bundle, base / "runtime", base / "bin")

    def test_existing_runtime_symlink_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "runtime"
            (root / "versions").mkdir(parents=True)
            outside = base / "outside"
            outside.mkdir()
            (root / "versions" / "1.0.0").symlink_to(outside)

            with self.assertRaisesRegex(HelperError, "must not be a symlink"):
                install_bundle(_fake_bundle(base, "1.0.0"), root, base / "bin")

    def test_rollback_runtime_symlink_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "runtime"
            bin_dir = base / "bin"
            install_bundle(_fake_bundle(base, "1.0.0"), root, bin_dir)
            install_bundle(_fake_bundle(base, "1.1.0"), root, bin_dir)
            retained = root / "versions" / "1.0.0"
            outside = base / "retained-copy"
            shutil.move(str(retained), outside)
            retained.symlink_to(outside)

            with self.assertRaisesRegex(HelperError, "must not be a symlink"):
                rollback_runtime(root, bin_dir, "1.0.0")

    def test_hook_fragment_uses_absolute_stable_command(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            command = Path(tmp) / "bin" / "codex-radar-hook"
            output = hook_config_output(command)
            payload = json.loads(output)

            commands = {
                group["hooks"][0]["command"]
                for groups in payload["hooks"].values()
                for group in groups
            }
            self.assertEqual({str(command.resolve())}, commands)
            self.assertNotIn("codex-radar hook", commands)

    def test_hook_fragment_quotes_space_path_and_upgrades_unquoted_stable_entry(self) -> None:
        with tempfile.TemporaryDirectory(prefix="radar helper ") as tmp:
            base = Path(tmp)
            command = base / "bin dir" / "codex-radar-hook"
            output = hook_config_output(command)
            payload = json.loads(output)
            rendered = payload["hooks"]["SessionStart"][0]["hooks"][0]["command"]
            self.assertEqual([str(command.resolve())], shlex.split(rendered))
            self.assertNotEqual(str(command.resolve()), rendered)

            hooks_file = base / "hooks.json"
            hooks_file.write_text(
                json.dumps(
                    {
                        "hooks": {
                            "SessionStart": [
                                {
                                    "hooks": [
                                        {
                                            "type": "command",
                                            "command": str(command.resolve()),
                                            "timeout": 5,
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                ),
                encoding="utf-8",
            )
            diff = hook_config_output(command, hooks_file)
            self.assertIn(rendered, diff)
            self.assertEqual(6, diff.count(rendered))

    def test_hook_diff_preserves_unrelated_hooks_and_does_not_write(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            hooks_file = base / "hooks.json"
            original = {
                "hooks": {
                    "SessionStart": [
                        {"hooks": [{"type": "command", "command": "other-hook"}]},
                        {"hooks": [{"type": "command", "command": "codex-radar hook"}]},
                    ]
                }
            }
            original_text = json.dumps(original)
            hooks_file.write_text(original_text, encoding="utf-8")

            diff = hook_config_output(base / "bin" / "codex-radar-hook", hooks_file)

            self.assertIn("other-hook", diff)
            self.assertIn(str((base / "bin" / "codex-radar-hook").resolve()), diff)
            self.assertIn("proposed; not written", diff)
            self.assertEqual(original_text, hooks_file.read_text(encoding="utf-8"))

    def test_hook_apply_backs_up_and_normalizes_duplicates_idempotently(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            hook_command = base / "bin" / "codex-radar-hook"
            hooks_file = base / "hooks.json"
            stable_command = str(hook_command.resolve())
            original = {
                "other": {"preserved": True},
                "hooks": {
                    event: [
                        {
                            "matcher": "keep",
                            "hooks": [
                                {"type": "command", "command": "other-hook", "timeout": 9},
                                {"type": "command", "command": "codex-radar hook", "timeout": 3},
                            ],
                        },
                        {
                            "hooks": [
                                {"type": "command", "command": stable_command, "timeout": 1},
                            ]
                        },
                    ]
                    for event in (
                        "SessionStart",
                        "UserPromptSubmit",
                        "PreToolUse",
                        "PostToolUse",
                        "PermissionRequest",
                        "Stop",
                    )
                },
            }
            original_bytes = json.dumps(original).encode("utf-8")
            hooks_file.write_bytes(original_bytes)

            result = apply_hook_config(hook_command, hooks_file)

            self.assertEqual("applied", result["action"])
            self.assertEqual("ready", result["hook_wiring"]["code"])
            backup = Path(result["backup"])
            self.assertEqual(original_bytes, backup.read_bytes())
            written = json.loads(hooks_file.read_text(encoding="utf-8"))
            self.assertEqual({"preserved": True}, written["other"])
            canonical = hook_fragment(hook_command)
            for event in canonical["hooks"]:
                groups = written["hooks"][event]
                commands = [
                    entry.get("command")
                    for group in groups
                    for entry in group["hooks"]
                    if isinstance(entry, dict)
                ]
                self.assertEqual(1, commands.count("other-hook"))
                self.assertEqual(
                    1,
                    commands.count(canonical["hooks"][event][0]["hooks"][0]["command"]),
                )
                self.assertNotIn("codex-radar hook", commands)

            unchanged = apply_hook_config(hook_command, hooks_file)
            self.assertEqual("unchanged", unchanged["action"])
            self.assertIsNone(unchanged["backup"])
            self.assertEqual(written, json.loads(hooks_file.read_text(encoding="utf-8")))

    def test_hook_apply_rejects_symlink_and_invalid_schema_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            hook_command = base / "bin" / "codex-radar-hook"
            invalid = base / "invalid.json"
            invalid.write_text('{"hooks": {"Stop": {}}}', encoding="utf-8")
            before = invalid.read_bytes()

            with self.assertRaisesRegex(HelperError, "hooks.Stop is not an array"):
                apply_hook_config(hook_command, invalid)
            self.assertEqual(before, invalid.read_bytes())

            target = base / "target.json"
            target.write_text("{}\n", encoding="utf-8")
            link = base / "link.json"
            link.symlink_to(target)
            with self.assertRaisesRegex(HelperError, "must not be a symlink"):
                apply_hook_config(hook_command, link)
            self.assertEqual("{}\n", target.read_text(encoding="utf-8"))

    def test_hook_apply_rolls_back_when_readback_validation_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            hook_command = base / "bin" / "codex-radar-hook"
            hooks_file = base / "hooks.json"
            original = b'{"hooks": {"Stop": []}}\n'
            hooks_file.write_bytes(original)

            with mock.patch(
                "codex_radar.helper_manager._hook_wiring_diagnostics",
                return_value={"code": "incomplete", "events": {}},
            ), self.assertRaisesRegex(HelperError, "failed readback validation"):
                apply_hook_config(hook_command, hooks_file)

            self.assertEqual(original, hooks_file.read_bytes())

    def test_diagnose_reports_duplicate_radar_hook_entries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "runtime"
            bin_dir = base / "bin"
            hooks_file = base / "hooks.json"
            install_bundle(_fake_bundle(base, "1.0.0"), root, bin_dir)
            fragment = hook_fragment(bin_dir / "codex-radar-hook")
            for event, groups in fragment["hooks"].items():
                groups.append(json.loads(json.dumps(groups[0])))
            hooks_file.write_text(json.dumps(fragment), encoding="utf-8")

            result = diagnose_helper(root, bin_dir, hooks_file)

            self.assertEqual("duplicate", result["hook_wiring"]["code"])
            self.assertEqual(
                {"duplicate"},
                set(result["hook_wiring"]["events"].values()),
            )

    def test_hook_config_apply_cli_is_explicit_and_returns_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            hooks_file = base / "hooks.json"
            hooks_file.write_text("{}\n", encoding="utf-8")
            output = io.StringIO()

            with redirect_stdout(output):
                result = main(
                    [
                        "--bin-dir",
                        str(base / "bin"),
                        "hook-config",
                        "--hooks-file",
                        str(hooks_file),
                        "--apply",
                    ]
                )

            self.assertEqual(0, result)
            payload = json.loads(output.getvalue())
            self.assertEqual("applied", payload["action"])
            self.assertEqual("ready", payload["hook_wiring"]["code"])

    def test_cli_reports_helper_errors_without_traceback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            error = io.StringIO()
            with redirect_stderr(error):
                result = main(["--root", tmp, "install", str(Path(tmp) / "missing")])
            self.assertEqual(2, result)
            self.assertIn("bundle manifest not found", error.getvalue())

    def test_diagnose_reports_missing_state_without_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            result = diagnose_helper(base / "runtime", base / "bin", base / "hooks.json")

            self.assertEqual("issues", result["status"])
            self.assertEqual("current_missing", result["runtime"]["code"])
            self.assertEqual({"missing"}, set(result["shims"].values()))
            self.assertEqual("runtime_unavailable", result["compatibility"]["code"])
            self.assertEqual("hooks_missing", result["hook_wiring"]["code"])
            self.assertNotIn(tmp, json.dumps(result))

    def test_diagnose_reports_ready_install_and_stable_hook_wiring(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "runtime"
            bin_dir = base / "bin"
            hooks_file = base / "hooks.json"
            install_bundle(_fake_bundle(base, "1.0.0"), root, bin_dir)
            hooks_file.write_text(
                json.dumps(hook_fragment(bin_dir / "codex-radar-hook")),
                encoding="utf-8",
            )

            result = diagnose_helper(root, bin_dir, hooks_file)

            self.assertEqual("ready", result["status"])
            self.assertEqual("ready", result["runtime"]["code"])
            self.assertEqual({"ready"}, set(result["shims"].values()))
            self.assertEqual("compatible", result["compatibility"]["code"])
            self.assertEqual("local_range_only", result["compatibility"]["extension_check"])
            self.assertEqual("ready", result["hook_wiring"]["code"])
            self.assertNotIn(tmp, json.dumps(result))

    def test_diagnose_detects_wrong_shim_legacy_and_partial_hooks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "runtime"
            bin_dir = base / "bin"
            hooks_file = base / "hooks.json"
            install_bundle(_fake_bundle(base, "1.0.0"), root, bin_dir)
            (bin_dir / "codex-radar-hook").unlink()
            (bin_dir / "codex-radar-hook").symlink_to(base / "other")
            hooks_file.write_text(
                json.dumps(
                    {
                        "hooks": {
                            event: [{"hooks": [{"command": "codex-radar hook"}]}]
                            for event in ("SessionStart", "Stop")
                        }
                    }
                ),
                encoding="utf-8",
            )

            result = diagnose_helper(root, bin_dir, hooks_file)

            self.assertEqual("wrong_target", result["shims"]["codex-radar-hook"])
            self.assertEqual("incomplete", result["hook_wiring"]["code"])
            self.assertEqual("legacy", result["hook_wiring"]["events"]["SessionStart"])
            self.assertEqual("missing", result["hook_wiring"]["events"]["PreToolUse"])

    def test_diagnose_rejects_broken_hooks_symlink_and_old_marker_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "runtime"
            bin_dir = base / "bin"
            hooks_file = base / "hooks.json"
            install_bundle(_fake_bundle(base, "1.0.0"), root, bin_dir)
            marker = root / "versions" / "1.0.0" / ".codex-radar-runtime.json"
            marker_payload = json.loads(marker.read_text(encoding="utf-8"))
            marker_payload.pop("python_requires")
            marker.write_text(json.dumps(marker_payload), encoding="utf-8")
            hooks_file.symlink_to(base / "missing-hooks.json")

            result = diagnose_helper(root, bin_dir, hooks_file)

            self.assertEqual("metadata_incomplete", result["compatibility"]["code"])
            self.assertEqual("hooks_symlink", result["hook_wiring"]["code"])

    def test_diagnose_cli_is_read_only_and_path_free(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "runtime"
            bin_dir = base / "bin"
            hooks_file = base / "hooks.json"
            install_bundle(_fake_bundle(base, "1.0.0"), root, bin_dir)
            hooks_file.write_text(
                json.dumps(hook_fragment(bin_dir / "codex-radar-hook")),
                encoding="utf-8",
            )
            before = {
                path.relative_to(base): (path.stat().st_mtime_ns, path.read_bytes())
                for path in base.rglob("*")
                if path.is_file() and not path.is_symlink()
            }
            output = io.StringIO()

            with redirect_stdout(output):
                result = main(
                    [
                        "--root", str(root),
                        "--bin-dir", str(bin_dir),
                        "diagnose",
                        "--hooks-file", str(hooks_file),
                    ]
                )

            after = {
                path.relative_to(base): (path.stat().st_mtime_ns, path.read_bytes())
                for path in base.rglob("*")
                if path.is_file() and not path.is_symlink()
            }
            self.assertEqual(0, result)
            self.assertEqual(before, after)
            self.assertEqual("ready", json.loads(output.getvalue())["status"])
            self.assertNotIn(tmp, output.getvalue())


class HelperBundleBuilderTests(unittest.TestCase):
    def test_builder_emits_manifested_zip_and_external_checksum(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            wheel = base / "codex_radar-1.2.3-py3-none-any.whl"
            with zipfile.ZipFile(wheel, "w") as archive:
                archive.writestr("codex_radar/__init__.py", "")
            output = base / "codex-radar-helper-1.2.3.zip"
            script = Path(__file__).resolve().parents[1] / "scripts" / "build-helper-bundle.py"

            result = subprocess.run(
                [sys.executable, str(script), "--wheel", str(wheel), "--output", str(output)],
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertEqual("", result.stderr)
            self.assertEqual(0, result.returncode)
            checksum = output.with_suffix(".zip.sha256")
            self.assertTrue(checksum.is_file())
            self.assertTrue(checksum.read_text(encoding="utf-8").startswith(_sha256(output)))
            with zipfile.ZipFile(output) as archive:
                names = archive.namelist()
                manifest_name = next(name for name in names if name.endswith("helper-manifest.json"))
                manifest = json.loads(archive.read(manifest_name))
                self.assertEqual("1.2.3", manifest["runtime_version"])
                self.assertEqual(">=3.9", manifest["python_requires"])
                self.assertEqual("0.4.3", manifest["compatibility"]["vscode_extension"]["minimum"])

    def test_builder_is_byte_reproducible_for_identical_input(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            wheel = base / "codex_radar-1.2.3-py3-none-any.whl"
            with zipfile.ZipFile(wheel, "w") as archive:
                archive.writestr("codex_radar/__init__.py", "")
            first = base / "first" / "codex-radar-helper-1.2.3.zip"
            second = base / "second" / "codex-radar-helper-1.2.3.zip"
            script = Path(__file__).resolve().parents[1] / "scripts" / "build-helper-bundle.py"

            for output in (first, second):
                subprocess.run(
                    [sys.executable, str(script), "--wheel", str(wheel), "--output", str(output)],
                    check=True,
                    capture_output=True,
                    text=True,
                )

            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(_sha256(first), _sha256(second))


@unittest.skipIf(os.name == "nt", "simulation supplements native Windows CI")
class WindowsFoundationSimulationTests(unittest.TestCase):
    def test_windows_install_upgrade_and_rollback_use_cmd_and_json_selector(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "runtime"
            bin_dir = base / "bin"
            with mock.patch("codex_radar.helper_manager.is_windows", return_value=True):
                install_bundle(_fake_bundle(base, "1.0.0"), root, bin_dir)
                stable = (bin_dir / "codex-radar-hook.cmd").read_bytes()
                install_bundle(_fake_bundle(base, "1.1.0"), root, bin_dir)
                self.assertEqual(
                    "1.1.0",
                    json.loads((root / "current.json").read_text(encoding="utf-8"))[
                        "runtime_version"
                    ],
                )
                self.assertEqual(stable, (bin_dir / "codex-radar-hook.cmd").read_bytes())
                self.assertFalse((root / "current").exists())
                rollback_runtime(root, bin_dir)
                self.assertEqual(
                    "1.0.0",
                    json.loads((root / "current.json").read_text(encoding="utf-8"))[
                        "runtime_version"
                    ],
                )


@unittest.skipUnless(os.name == "nt", "native Windows helper test")
class WindowsHelperManagerTests(unittest.TestCase):
    def test_default_local_app_data_fallback(self) -> None:
        self.assertEqual(
            Path("C:/Users/example/AppData/Local"),
            windows_local_app_data({}, home=Path("C:/Users/example")),
        )

    def test_hook_apply_handles_windows_command_paths_and_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            hook_command = base / "bin with space" / "codex-radar-hook.cmd"
            hooks_file = base / "hooks.json"
            fragment = hook_fragment(hook_command)
            for event, groups in fragment["hooks"].items():
                groups.insert(
                    0,
                    {
                        "hooks": [
                            {"type": "command", "command": "unrelated-hook.cmd"},
                            {"type": "command", "command": "codex-radar hook"},
                        ]
                    },
                )
            hooks_file.write_text(json.dumps(fragment), encoding="utf-8")

            applied = apply_hook_config(hook_command, hooks_file)
            unchanged = apply_hook_config(hook_command, hooks_file)

            self.assertEqual("applied", applied["action"])
            self.assertEqual("ready", applied["hook_wiring"]["code"])
            self.assertEqual("unchanged", unchanged["action"])
            written = json.loads(hooks_file.read_text(encoding="utf-8"))
            expected = hook_fragment(hook_command)
            for event in expected["hooks"]:
                commands = [
                    entry["command"]
                    for group in written["hooks"][event]
                    for entry in group["hooks"]
                ]
                self.assertEqual(1, commands.count("unrelated-hook.cmd"))
                self.assertEqual(
                    1,
                    commands.count(expected["hooks"][event][0]["hooks"][0]["command"]),
                )
                self.assertNotIn("codex-radar hook", commands)

    def test_install_upgrade_rollback_and_cmd_launchers(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "runtime"
            bin_dir = base / "bin"
            first = _fake_bundle(base, "1.0.0")
            second = _fake_bundle(base, "1.1.0")

            install_bundle(first, root, bin_dir)
            stable_hook = (bin_dir / "codex-radar-hook.cmd").read_bytes()
            install_bundle(second, root, bin_dir)

            current = json.loads((root / "current.json").read_text(encoding="utf-8"))
            self.assertEqual("1.1.0", current["runtime_version"])
            self.assertEqual(stable_hook, (bin_dir / "codex-radar-hook.cmd").read_bytes())
            self.assertFalse((root / "current").exists())
            self.assertTrue((root / "current-dispatch.py").is_file())

            launched = subprocess.run(
                ["cmd.exe", "/d", "/c", str(bin_dir / "codex-radar-hook.cmd")],
                input=json.dumps(
                    {
                        "hook_event_name": "Stop",
                        "session_id": "windows-smoke",
                        "cwd": str(base / "repo"),
                    }
                ),
                check=False,
                capture_output=True,
                text=True,
                env={**os.environ, "CODEX_RADAR_HOME": str(base / "state")},
            )
            self.assertEqual(0, launched.returncode, launched.stderr)
            self.assertEqual("1.1.0", launched.stdout)

            rollback_runtime(root, bin_dir)
            selected = json.loads((root / "current.json").read_text(encoding="utf-8"))
            self.assertEqual("1.0.0", selected["runtime_version"])
            rolled_back = subprocess.run(
                ["cmd.exe", "/d", "/c", str(bin_dir / "codex-radar-hook.cmd")],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(0, rolled_back.returncode, rolled_back.stderr)
            self.assertEqual("1.0.0", rolled_back.stdout)

    def test_hook_config_uses_stable_cmd_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            command = base / "bin" / "codex-radar-hook.cmd"
            hooks_file = base / "hooks.json"
            hooks_file.write_text('{"hooks": {}}\n', encoding="utf-8")

            fragment = json.loads(hook_config_output(command))
            rendered = fragment["hooks"]["Stop"][0]["hooks"][0]["command"]
            self.assertIn("codex-radar-hook.cmd", rendered)
            before = hooks_file.read_bytes()
            diff = hook_config_output(command, hooks_file)
            self.assertIn("proposed; not written", diff)
            self.assertEqual(before, hooks_file.read_bytes())
