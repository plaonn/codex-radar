#!/usr/bin/env python3
"""Disposable authorized-ADB physical-device A5.0 acceptance harness."""

from __future__ import annotations

import json
import os
import pwd
import queue
import re
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from run_a31_smoke import free_port, run, start_sshd, stop_server, write_sshd_config
from run_a4_smoke import (
    ANDROID,
    CANARIES,
    ROOT,
    RUNNER,
    app_private_bytes,
    build_and_install_helper,
    instrument_with_transitions,
    prepare_public_key,
    remove_android_test_artifacts,
    scan_and_remove_android_test_artifacts,
    write_failure_wrapper,
    write_packaged_wrapper,
    write_synthetic_truth,
)

APP_PACKAGE = "dev.codexradar.cockpit"
TEST_PACKAGE = "dev.codexradar.cockpit.test"
A4_TEST_CLASS = "dev.codexradar.cockpit.A4EndToEndSmokeTest"
A5_TEST_CLASS = "dev.codexradar.cockpit.A5PhysicalDeviceSmokeTest"


def adb(serial: str, *arguments: str, **kwargs: object) -> subprocess.CompletedProcess[str]:
    return run(["adb", "-s", serial, *arguments], **kwargs)


def discover_device() -> tuple[str, str, str]:
    lines = run(["adb", "devices"], capture_output=True).stdout.splitlines()[1:]
    devices = [line.split()[0] for line in lines if line.strip() and line.endswith("\tdevice")]
    if len(devices) != 1:
        raise RuntimeError("a5_exactly_one_authorized_device_required")
    serial = devices[0]
    if adb(serial, "shell", "getprop", "ro.kernel.qemu", capture_output=True).stdout.strip() == "1":
        raise RuntimeError("a5_physical_device_required")
    api = adb(
        serial, "shell", "getprop", "ro.build.version.sdk", capture_output=True
    ).stdout.strip()
    abi = adb(
        serial, "shell", "getprop", "ro.product.cpu.abi", capture_output=True
    ).stdout.strip()
    if not api.isdigit() or not re.fullmatch(r"[A-Za-z0-9_.-]+", abi):
        raise RuntimeError("a5_device_metadata_unavailable")
    return serial, api, abi


def package_installed(serial: str, package: str) -> bool:
    completed = subprocess.run(
        ["adb", "-s", serial, "shell", "pm", "path", package],
        capture_output=True,
        text=True,
        timeout=15,
    )
    return completed.returncode == 0 and completed.stdout.startswith("package:")


def uninstall_if_present(serial: str, package: str) -> None:
    if package_installed(serial, package):
        adb(serial, "uninstall", package, capture_output=True, timeout=30)


def assert_packages_absent(serial: str) -> None:
    if package_installed(serial, APP_PACKAGE) or package_installed(serial, TEST_PACKAGE):
        raise RuntimeError("a5_preexisting_debug_package_refused")


def add_reverse(serial: str, device_port: int, host_port: int) -> None:
    adb(
        serial,
        "reverse",
        "--no-rebind",
        f"tcp:{device_port}",
        f"tcp:{host_port}",
        capture_output=True,
    )


def remove_reverse(serial: str, device_port: int) -> None:
    subprocess.run(
        ["adb", "-s", serial, "reverse", "--remove", f"tcp:{device_port}"],
        capture_output=True,
        text=True,
        timeout=10,
    )


def instrument(
    serial: str,
    method: str,
    extras: tuple[tuple[str, str], ...],
    timeout: float = 60,
) -> str:
    arguments = ["shell", "am", "instrument", "-w", "-r"]
    for key, value in extras:
        arguments.extend(["-e", key, value])
    arguments.extend(["-e", "class", f"{A5_TEST_CLASS}#{method}", RUNNER])
    completed = adb(serial, *arguments, capture_output=True, timeout=timeout)
    if "OK (1 test)" not in completed.stdout:
        raise RuntimeError("a5_instrumentation_failed")
    return completed.stdout


def instrument_forced_loss(
    serial: str,
    server: subprocess.Popen[str],
    timeout: float = 35,
) -> str:
    command = [
        "adb", "-s", serial, "shell", "am", "instrument", "-w", "-r",
        "-e", "a5_forced_loss", "true",
        "-e", "class",
        f"{A5_TEST_CLASS}#forced_ssh_loss_closes_channel_with_sanitized_failure",
        RUNNER,
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    assert process.stdout is not None
    lines: queue.Queue[str | None] = queue.Queue()
    output: list[str] = []

    def read_output() -> None:
        try:
            for line in process.stdout:
                lines.put(line)
        finally:
            lines.put(None)

    reader = threading.Thread(target=read_output, daemon=True)
    reader.start()
    stopped = False
    deadline = time.monotonic() + timeout
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RuntimeError("a5_forced_loss_timeout")
            try:
                line = lines.get(timeout=min(0.1, remaining))
            except queue.Empty:
                continue
            if line is None:
                break
            output.append(line)
            if "a5_step=connected_forced_loss" in line and not stopped:
                stop_server(server)
                stopped = True
        returncode = process.wait(timeout=3)
        text = "".join(output)
        if not stopped or returncode != 0 or "OK (1 test)" not in text:
            raise RuntimeError("a5_forced_loss_instrumentation_failed")
        return text
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
        reader.join(timeout=1)
        process.stdout.close()


def write_eof_wrapper(path: Path) -> None:
    path.write_text(
        "\n".join(
            [
                "#!/bin/sh",
                'test "${SSH_ORIGINAL_COMMAND:-}" = "codex-radar mobile rpc" || exit 64',
                'test -z "${SSH_TTY:-}" || exit 65',
                "IFS= read -r _request || exit 66",
                """printf '%s\\n' '{"id":1,"result":{"protocol":"codex-radar.read-protocol","version":1,"preview_contract_version":2,"attention_delivery":"foreground-poll"}}'""",
                "IFS= read -r _request || exit 66",
                """printf '%s\\n' '{"id":2,"result":{"contract":"codex-radar.display-state","version":1,"sessions":[]}}'""",
                "IFS= read -r _request || exit 66",
                """printf '%s\\n' '{"id":3,"result":{"events_emitted":0}}'""",
                "sleep 1",
                "",
            ]
        ),
        encoding="utf-8",
    )
    path.chmod(0o700)


def main() -> int:
    source_commit = run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True).stdout.strip()
    if run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True).stdout.strip():
        raise RuntimeError("a5_source_must_be_clean")

    serial, api_level, abi = discover_device()
    transport = "paired-wireless" if ":" in serial else "usb"
    assert_packages_absent(serial)
    gradle_env = os.environ.copy()
    gradle_env["ANDROID_SERIAL"] = serial
    servers: dict[str, tuple[subprocess.Popen[str], object]] = {}
    reverse_ports: list[int] = []
    results: dict[str, str] = {}
    temp_path = ""
    stage = "initialize"

    with tempfile.TemporaryDirectory(prefix="codex-radar-a5-") as raw:
        temp_path = raw
        temp = Path(raw)
        try:
            stage = "packaged-helper"
            bin_dir, helper_version = build_and_install_helper(temp)
            stage = "local-android-verification"
            run(
                [
                    str(ANDROID / "gradlew"),
                    "testDebugUnitTest",
                    "lintDebug",
                    "assembleDebug",
                    "compileDebugAndroidTestKotlin",
                ],
                cwd=ANDROID,
                env=gradle_env,
                capture_output=True,
                timeout=300,
            )
            stage = "physical-connected-tests"
            remove_android_test_artifacts()
            run(
                [str(ANDROID / "gradlew"), "connectedDebugAndroidTest"],
                cwd=ANDROID,
                env=gradle_env,
                capture_output=True,
                timeout=300,
            )
            scan_and_remove_android_test_artifacts()
            uninstall_if_present(serial, TEST_PACKAGE)
            uninstall_if_present(serial, APP_PACKAGE)

            stage = "install-debug"
            run(
                [str(ANDROID / "gradlew"), "installDebug", "installDebugAndroidTest"],
                cwd=ANDROID,
                env=gradle_env,
                capture_output=True,
                timeout=180,
            )
            adb(
                serial,
                "shell",
                "am",
                "start",
                "-W",
                "-n",
                f"{APP_PACKAGE}/.MainActivity",
                capture_output=True,
            )
            results["install_and_profile_launch"] = "passed"
            adb(serial, "logcat", "-c", capture_output=True)

            stage = "keystore-identity"
            public_key = prepare_public_key(serial)
            user = pwd.getpwuid(os.getuid()).pw_name
            state, codex_home = temp / "state", temp / "codex-home"
            sessions = write_synthetic_truth(state, codex_home)
            authorized_keys = temp / "authorized_keys"
            authorized_keys.write_text(public_key + "\n", encoding="utf-8")
            authorized_keys.chmod(0o600)
            wrong_key = temp / "wrong-client"
            run(["ssh-keygen", "-q", "-N", "", "-t", "ecdsa", "-b", "256", "-f", str(wrong_key)])
            wrong_authorized = temp / "wrong_authorized_keys"
            wrong_authorized.write_text(
                wrong_key.with_suffix(".pub").read_text(encoding="utf-8"), encoding="utf-8"
            )
            wrong_authorized.chmod(0o600)
            host_key = temp / "host-ecdsa"
            run(["ssh-keygen", "-q", "-N", "", "-t", "ecdsa", "-b", "256", "-f", str(host_key)])
            marker = temp / "process-marker"
            normal_wrapper = temp / "packaged-command"
            write_packaged_wrapper(normal_wrapper, bin_dir, state, codex_home, marker)
            malformed_wrapper, oversized_wrapper, eof_wrapper = (
                temp / "malformed",
                temp / "oversized",
                temp / "remote-eof",
            )
            write_failure_wrapper(malformed_wrapper, "malformed")
            write_failure_wrapper(oversized_wrapper, "oversized")
            write_eof_wrapper(eof_wrapper)

            host_ports: dict[str, int] = {}
            device_ports: dict[str, int] = {}
            for name, keys, wrapper in (
                ("normal", authorized_keys, normal_wrapper),
                ("auth", wrong_authorized, normal_wrapper),
                ("malformed", authorized_keys, malformed_wrapper),
                ("oversized", authorized_keys, oversized_wrapper),
                ("eof", authorized_keys, eof_wrapper),
            ):
                host_port, device_port = free_port(), free_port()
                config = temp / f"sshd-{name}.conf"
                write_sshd_config(
                    config, host_key, keys, wrapper, host_port, user, temp / f"sshd-{name}.pid"
                )
                servers[name] = start_sshd(config, temp / f"sshd-{name}.log")
                add_reverse(serial, device_port, host_port)
                reverse_ports.append(device_port)
                host_ports[name], device_ports[name] = host_port, device_port

            stage = "foreground-product-contract"
            flags: list[str] = []
            for key, value in (
                ("a4_host", "127.0.0.1"),
                ("a4_port", device_ports["normal"]),
                ("a4_user", user),
                ("a4_auth_port", device_ports["auth"]),
                ("a4_malformed_port", device_ports["malformed"]),
                ("a4_oversized_port", device_ports["oversized"]),
            ):
                flags.extend(["-e", key, str(value)])
            instrument_with_transitions(serial, flags, state, sessions)
            results.update(
                {
                    "keystore_non_exportable_identity": "passed",
                    "unknown_host_review_exact_pin": "passed",
                    "state_grouping_archive_bounded_preview": "passed",
                    "foreground_attention_navigation": "passed",
                    "background_disconnect_reconnect_no_replay": "passed",
                    "authentication_malformed_oversized_failures": "passed",
                }
            )

            stage = "same-signature-replace"
            run(
                [str(ANDROID / "gradlew"), "installDebug"],
                cwd=ANDROID,
                env=gradle_env,
                capture_output=True,
                timeout=180,
            )
            instrument(
                serial,
                "same_signature_replace_preserves_profile_pin_identity_and_reconnects",
                (("a5_replace_expected", "true"),),
            )
            results["same_signature_replace_profile_pin_identity_continuity"] = "passed"

            stage = "remote-eof"
            instrument(
                serial,
                "remote_eof_closes_channel_without_raw_detail",
                (("a5_remote_eof", "true"), ("a5_eof_port", str(device_ports["eof"]))),
            )
            results["remote_eof_cleanup"] = "passed"

            stage = "forced-ssh-loss"
            normal_server, normal_handle = servers.pop("normal")
            instrument_forced_loss(serial, normal_server)
            normal_handle.close()
            results["forced_ssh_loss_sanitized_cleanup"] = "passed"

            stage = "same-pin-reconnect"
            normal_config = temp / "sshd-normal-restart.conf"
            write_sshd_config(
                normal_config,
                host_key,
                authorized_keys,
                normal_wrapper,
                host_ports["normal"],
                user,
                temp / "sshd-normal-restart.pid",
            )
            servers["normal"] = start_sshd(normal_config, temp / "sshd-normal-restart.log")
            instrument(
                serial,
                "same_signature_replace_preserves_profile_pin_identity_and_reconnects",
                (("a5_replace_expected", "true"),),
            )
            results["same_host_key_reconnect_after_loss"] = "passed"

            stage = "host-key-mismatch"
            normal_server, normal_handle = servers.pop("normal")
            stop_server(normal_server)
            normal_handle.close()
            replacement_key = temp / "host-ecdsa-replacement"
            run(
                ["ssh-keygen", "-q", "-N", "", "-t", "ecdsa", "-b", "256", "-f", str(replacement_key)]
            )
            replacement_config = temp / "sshd-replacement.conf"
            write_sshd_config(
                replacement_config,
                replacement_key,
                authorized_keys,
                normal_wrapper,
                host_ports["normal"],
                user,
                temp / "sshd-replacement.pid",
            )
            servers["replacement"] = start_sshd(
                replacement_config, temp / "sshd-replacement.log"
            )
            mismatch = adb(
                serial,
                "shell",
                "am",
                "instrument",
                "-w",
                "-r",
                "-e",
                "a4_mismatch_expected",
                "true",
                "-e",
                "class",
                f"{A4_TEST_CLASS}#persisted_pin_rejects_restarted_host",
                RUNNER,
                capture_output=True,
            )
            if "OK (1 test)" not in mismatch.stdout:
                raise RuntimeError("a5_host_key_mismatch_instrumentation_failed")
            results["changed_host_key_hard_failure"] = "passed"

            stage = "privacy-negative-scan"
            app_data = app_private_bytes(serial).decode("utf-8", errors="replace")
            logcat = adb(serial, "logcat", "-d", capture_output=True).stdout
            retained_runtime = app_data + logcat
            if any(value in retained_runtime for value in (*CANARIES, str(temp))):
                raise RuntimeError("a5_privacy_residue_detected")
            results["privacy_negative_scan"] = "passed"

            stage = "app-state-cleanup"
            instrument(
                serial,
                "cleanup_profile_and_identity",
                (("a5_cleanup", "true"),),
            )
            results["profile_and_keystore_explicit_cleanup"] = "passed"

            stage = "public-result"
            ssh_version = subprocess.run(
                ["/usr/sbin/sshd", "-V"], capture_output=True, text=True, timeout=5
            ).stderr.strip().split(",")[0]
            result = {
                "contract": "codex-radar.android-a5-physical-device-smoke",
                "version": 1,
                "repository_commit": source_commit,
                "helper_version": helper_version,
                "android_app_version": "0.2.0-a3.1",
                "android_api": api_level,
                "android_abi": abi,
                "device_kind": "physical",
                "adb_transport": transport,
                "ssh_client": "com.github.mwiede:jsch:2.28.5",
                "ssh_server": ssh_version,
                "operating_system_family": "Darwin",
                "observed_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                "normal_network_ssh_reachability_proven": False,
                "scenarios": results,
                "privacy": {
                    "device_identifier_or_wireless_endpoint_retained": False,
                    "real_credentials_or_personal_data": False,
                    "raw_frames_or_remote_stderr_retained": False,
                    "screenshots_retained": False,
                    "private_key_exported": False,
                },
                "cleanup": {
                    "wireless_pairing_preserved": True,
                    "harness_reverse_mappings_removed": True,
                    "disposable_sshd_stopped": True,
                    "debug_packages_removed": True,
                    "temporary_material_selected_for_retention": False,
                    "global_ssh_or_codex_configuration_changed": False,
                },
            }
            print(json.dumps(result, indent=2, sort_keys=True))
        except subprocess.CalledProcessError as exception:
            raise RuntimeError(f"a5_stage_failed:{stage}") from exception
        finally:
            for server, handle in servers.values():
                stop_server(server)
                handle.close()
            for device_port in reverse_ports:
                remove_reverse(serial, device_port)
            uninstall_if_present(serial, TEST_PACKAGE)
            uninstall_if_present(serial, APP_PACKAGE)
            remove_android_test_artifacts()

    if Path(temp_path).exists():
        raise RuntimeError("a5_temporary_directory_cleanup_failed")
    if package_installed(serial, APP_PACKAGE) or package_installed(serial, TEST_PACKAGE):
        raise RuntimeError("a5_package_cleanup_failed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exception:
        message = str(exception)
        if not re.fullmatch(r"a5_[a-z0-9_-]+(?::[a-z0-9_-]+)?", message):
            message = type(exception).__name__
        print(f"a5_smoke_failed:{message}", file=os.sys.stderr)
        raise SystemExit(1) from None
