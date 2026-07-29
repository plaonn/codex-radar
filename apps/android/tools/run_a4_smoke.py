#!/usr/bin/env python3
"""Disposable Android-emulator to packaged-helper A4 acceptance harness."""

from __future__ import annotations

import json
import os
import pwd
import queue
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from run_a31_smoke import (
    free_port,
    run,
    start_sshd,
    stop_server,
    write_sshd_config,
)

ROOT = Path(__file__).resolve().parents[3]
ANDROID = ROOT / "apps" / "android"
RUNNER = "dev.codexradar.cockpit.test/androidx.test.runner.AndroidJUnitRunner"
TEST_CLASS = "dev.codexradar.cockpit.A4EndToEndSmokeTest"
AVD = "Medium_Phone_API_36.1"
HOST_ALIAS = "10.0.2.2"
CANARIES = (
    "sk-A4SensitiveCredentialValue",
    "A4_RAW_REQUEST_CANARY",
    "A4_UNREDACTED_TRANSCRIPT_CANARY",
    "A4_REMOTE_STDERR_CANARY",
    "PRIVATE KEY",
)


def wait_for_boot(serial: str, timeout: float = 180.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        completed = subprocess.run(
            ["adb", "-s", serial, "shell", "getprop", "sys.boot_completed"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if completed.returncode == 0 and completed.stdout.strip() == "1":
            run(["adb", "-s", serial, "shell", "input", "keyevent", "82"])
            package_manager = subprocess.run(
                ["adb", "-s", serial, "shell", "cmd", "package", "list", "packages"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if package_manager.returncode == 0 and "package:android" in package_manager.stdout:
                time.sleep(5)
                return
        time.sleep(1)
    raise RuntimeError("emulator_boot_timeout")


def emulator_ports_available(console_port: int) -> bool:
    for candidate in (console_port, console_port + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            try:
                probe.bind(("127.0.0.1", candidate))
            except OSError:
                return False
    return True


def start_emulator(temp: Path) -> tuple[subprocess.Popen[str], str, object]:
    emulator = shutil.which("emulator")
    if not emulator:
        raise RuntimeError("android_emulator_unavailable")
    emulator_port = next(
        (port for port in range(5554, 5682, 2) if emulator_ports_available(port)),
        None,
    )
    if emulator_port is None:
        raise RuntimeError("android_emulator_port_unavailable")
    log = (temp / "emulator.log").open("w+", encoding="utf-8")
    process: subprocess.Popen[str] | None = None
    serial = f"emulator-{emulator_port}"
    try:
        process = subprocess.Popen(
            [
                emulator,
                "-avd",
                AVD,
                "-port",
                str(emulator_port),
                "-no-window",
                "-no-audio",
                "-no-boot-anim",
                "-no-snapshot",
                "-wipe-data",
                "-gpu",
                "swiftshader_indirect",
            ],
            stdout=log,
            stderr=subprocess.STDOUT,
            text=True,
        )
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            connected = subprocess.run(
                ["adb", "-s", serial, "get-state"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if connected.returncode == 0 and connected.stdout.strip() == "device":
                break
            if process.poll() is not None:
                raise RuntimeError("emulator_start_failed")
            time.sleep(0.5)
        else:
            raise RuntimeError("emulator_serial_unavailable")
        wait_for_boot(serial)
        return process, serial, log
    except BaseException:
        if process is not None:
            stop_emulator(process, serial, log)
        else:
            log.close()
        raise


def stop_emulator(process: subprocess.Popen[str], serial: str, log: object) -> None:
    if serial:
        try:
            subprocess.run(
                ["adb", "-s", serial, "emu", "kill"],
                capture_output=True,
                text=True,
                timeout=5,
            )
        except (OSError, subprocess.SubprocessError):
            pass
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    log.close()


def build_and_install_helper(temp: Path) -> tuple[Path, str]:
    dist = temp / "dist"
    dist.mkdir()
    run(
        ["uv", "build", "--wheel", "--out-dir", str(dist)],
        cwd=ROOT,
        capture_output=True,
    )
    wheel = next(dist.glob("codex_radar-*.whl"))
    bundle = dist / "codex-radar-helper.zip"
    run(
        [
            sys.executable,
            str(ROOT / "scripts" / "build-helper-bundle.py"),
            "--wheel",
            str(wheel),
            "--output",
            str(bundle),
        ],
        cwd=ROOT,
        capture_output=True,
    )
    extracted = temp / "bundle"
    with zipfile.ZipFile(bundle) as archive:
        archive.extractall(extracted)
    bundle_dir = next(extracted.iterdir())
    runtime_root, bin_dir = temp / "runtime", temp / "bin"
    run(
        [
            sys.executable,
            str(bundle_dir / "install-helper.py"),
            "--root",
            str(runtime_root),
            "--bin-dir",
            str(bin_dir),
            "install",
            str(bundle_dir),
        ],
        capture_output=True,
    )
    help_text = run([str(bin_dir / "codex-radar"), "--help"], capture_output=True).stdout
    if "mobile" not in help_text:
        raise RuntimeError("packaged_mobile_rpc_missing")
    version = re.search(r"codex_radar-(\d+\.\d+\.\d+)", wheel.name)
    if not version:
        raise RuntimeError("helper_version_unavailable")
    return bin_dir, version.group(1)


def prepare_public_key(serial: str) -> str:
    completed = run(
        [
            "adb",
            "-s",
            serial,
            "shell",
            "am",
            "instrument",
            "-w",
            "-r",
            "-e",
            "a4_prepare_key",
            "true",
            "-e",
            "class",
            f"{TEST_CLASS}#prepare_non_exportable_keystore_key",
            RUNNER,
        ],
        capture_output=True,
    )
    match = re.search(
        r"a4_public_key_openssh=(ecdsa-sha2-nistp256 [A-Za-z0-9+/=]+ [^\s]+)",
        completed.stdout,
    )
    if not match:
        raise RuntimeError("a4_keystore_public_key_not_emitted")
    return match.group(1)


def synthetic_session(
    session_id: str,
    project: str,
    status: str,
    transcript: Path,
    now: str,
) -> dict[str, object]:
    return {
        "session_id": session_id,
        "cwd": f"/synthetic/{project}",
        "project": project,
        "status": status,
        "display_state": "running" if status == "tool_running" else status,
        "first_seen_at": now,
        "last_seen_at": now,
        "display_state_started_at": now,
        "event_count": 1,
        "last_event_name": "SyntheticEvent",
        "last_assistant_message": "synthetic only",
        "model": "synthetic-model",
        "permission_mode": "default",
        "transcript_path": str(transcript),
        "turn_id": f"turn-{session_id}",
        "current_tool": "SyntheticTool" if status == "tool_running" else "",
    }


def write_synthetic_truth(state: Path, codex_home: Path) -> dict[str, dict[str, object]]:
    active_transcript = codex_home / "sessions" / "rollout-opaque-preview.jsonl"
    archived_transcript = codex_home / "archived_sessions" / "rollout-opaque-archived.jsonl"
    active_transcript.parent.mkdir(parents=True)
    archived_transcript.parent.mkdir(parents=True)
    messages = (
        {"role": "user", "content": [{"text": "synthetic bounded preview"}]},
        {
            "role": "assistant",
            "content": [
                {
                    "text": (
                        "redact sk-A4SensitiveCredentialValue "
                        "token=A4_UNREDACTED_TRANSCRIPT_CANARY"
                    )
                }
            ],
        },
    )
    active_transcript.write_text(
        "\n".join(json.dumps(item) for item in messages) + "\n", encoding="utf-8"
    )
    archived_transcript.write_text(
        json.dumps({"role": "assistant", "content": [{"text": "synthetic archived"}]}) + "\n",
        encoding="utf-8",
    )
    now = datetime.now(timezone.utc).isoformat()
    sessions = {
        "opaque-historical": synthetic_session(
            "opaque-historical", "alpha", "waiting_approval", active_transcript, now
        ),
        "opaque-preview": synthetic_session(
            "opaque-preview", "alpha", "done", active_transcript, now
        ),
        "opaque-running": synthetic_session(
            "opaque-running", "beta", "tool_running", active_transcript, now
        ),
        "opaque-offline": synthetic_session(
            "opaque-offline", "beta", "running", active_transcript, now
        ),
        "opaque-archived": synthetic_session(
            "opaque-archived", "beta", "done", archived_transcript, now
        ),
    }
    state.mkdir()
    (state / "sessions.json").write_text(
        json.dumps({"schema_version": 1, "sessions": sessions, "updated_at": now}),
        encoding="utf-8",
    )
    return sessions


def persist_sessions(state: Path, sessions: dict[str, dict[str, object]]) -> None:
    now = datetime.now(timezone.utc).isoformat()
    for session in sessions.values():
        session["last_seen_at"] = now
    target = state / "sessions.json"
    temporary = target.with_suffix(".tmp")
    temporary.write_text(
        json.dumps({"schema_version": 1, "sessions": sessions, "updated_at": now}),
        encoding="utf-8",
    )
    temporary.replace(target)


def write_packaged_wrapper(
    path: Path,
    bin_dir: Path,
    state: Path,
    codex_home: Path,
    marker: Path,
) -> None:
    path.write_text(
        "\n".join(
            [
                "#!/bin/sh",
                'test "${SSH_ORIGINAL_COMMAND:-}" = "codex-radar mobile rpc" || exit 64',
                'test -z "${SSH_TTY:-}" || exit 65',
                f"export PATH={bin_dir}:/usr/bin:/bin",
                f"export CODEX_RADAR_HOME={state}",
                f"export CODEX_HOME={codex_home}",
                f"printf '%s\\n' process-started >> {marker}",
                "printf '%s\\n' A4_REMOTE_STDERR_CANARY >&2",
                "codex-radar mobile rpc",
                "status=$?",
                f"printf '%s\\n' process-stopped >> {marker}",
                "exit \"$status\"",
                "",
            ]
        ),
        encoding="utf-8",
    )
    path.chmod(0o700)


def write_failure_wrapper(path: Path, mode: str) -> None:
    lines = [
        "#!/bin/sh",
        'test "${SSH_ORIGINAL_COMMAND:-}" = "codex-radar mobile rpc" || exit 64',
        'test -z "${SSH_TTY:-}" || exit 65',
        "IFS= read -r _request || exit 66",
    ]
    if mode == "malformed":
        lines.append("printf 'not-json\\n'")
    elif mode == "oversized":
        lines.append("head -c 1048577 /dev/zero | tr '\\000' x; printf '\\n'")
    else:
        raise ValueError(mode)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    path.chmod(0o700)


def instrument_with_transitions(
    serial: str,
    arguments: list[str],
    state: Path,
    sessions: dict[str, dict[str, object]],
    timeout_seconds: float = 60,
) -> str:
    command = [
        "adb",
        "-s",
        serial,
        "shell",
        "am",
        "instrument",
        "-w",
        "-r",
        *arguments,
        "-e",
        "class",
        f"{TEST_CLASS}#foreground_ui_state_preview_attention_background_reconnect_and_failures",
        RUNNER,
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    assert process.stdout is not None
    output: list[str] = []
    lines: queue.Queue[str | None] = queue.Queue()
    reader: threading.Thread | None = None
    last_step = "startup"

    def read_output() -> None:
        try:
            for line in process.stdout:
                lines.put(line)
        finally:
            lines.put(None)

    try:
        reader = threading.Thread(target=read_output, daemon=True)
        reader.start()
        deadline = time.monotonic() + timeout_seconds
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RuntimeError("a4_foreground_instrumentation_timeout")
            try:
                line = lines.get(timeout=min(0.1, remaining))
            except queue.Empty:
                continue
            if line is None:
                break
            output.append(line)
            step_match = re.search(r"a4_step=([a-z0-9_]+)", line)
            if step_match:
                last_step = step_match.group(1)
            if "a4_step=waiting_ready" in line:
                sessions["opaque-preview"]["status"] = "waiting_approval"
                sessions["opaque-preview"]["display_state"] = "waiting_approval"
                persist_sessions(state, sessions)
            elif "a4_step=running_done" in line:
                sessions["opaque-running"]["status"] = "done"
                sessions["opaque-running"]["display_state"] = "done"
                persist_sessions(state, sessions)
            elif "a4_step=backgrounded" in line:
                sessions["opaque-offline"]["status"] = "waiting_approval"
                sessions["opaque-offline"]["display_state"] = "waiting_approval"
                persist_sessions(state, sessions)
        try:
            returncode = process.wait(timeout=3)
        except subprocess.TimeoutExpired as exception:
            raise RuntimeError("a4_foreground_instrumentation_timeout") from exception
        text = "".join(output)
        if returncode != 0 or "OK (1 test)" not in text:
            raise RuntimeError(f"a4_foreground_instrumentation_failed:{last_step}")
        return text
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
        if reader is not None:
            reader.join(timeout=1)
        process.stdout.close()


def app_private_bytes(serial: str) -> bytes:
    command = (
        "for f in shared_prefs/* files/* databases/*; do "
        '[ -f "$f" ] && cat "$f"; done; exit 0'
    )
    return subprocess.run(
        ["adb", "-s", serial, "exec-out", "run-as", "dev.codexradar.cockpit", "sh", "-c", command],
        check=True,
        capture_output=True,
        timeout=30,
    ).stdout


def android_test_artifact_roots() -> tuple[Path, ...]:
    return (
        ANDROID / "app" / "build" / "outputs" / "androidTest-results",
        ANDROID / "app" / "build" / "reports" / "androidTests",
    )


def remove_android_test_artifacts() -> None:
    roots = android_test_artifact_roots()
    for root in roots:
        shutil.rmtree(root, ignore_errors=True)
    if any(root.exists() for root in roots):
        raise RuntimeError("a4_android_test_artifact_cleanup_failed")


def scan_and_remove_android_test_artifacts() -> None:
    roots = android_test_artifact_roots()
    leaked = False
    try:
        for root in roots:
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if not path.is_file():
                    continue
                data = path.read_bytes()
                if b"_public_key_openssh=" in data or any(
                    canary.encode("utf-8") in data for canary in CANARIES
                ):
                    leaked = True
        if leaked:
            raise RuntimeError("a4_android_test_artifact_privacy_failed")
    finally:
        remove_android_test_artifacts()


def main() -> int:
    source_commit = run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True).stdout.strip()
    if run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True).stdout.strip():
        raise RuntimeError("a4_source_must_be_clean")

    emulator_process: subprocess.Popen[str] | None = None
    emulator_serial = ""
    emulator_log: object | None = None
    previous_android_serial = os.environ.get("ANDROID_SERIAL")
    servers: list[tuple[subprocess.Popen[str], object]] = []
    results: dict[str, str] = {}
    temp_path = ""
    stage = "initialize"
    with tempfile.TemporaryDirectory(prefix="codex-radar-a4-") as raw:
        temp_path = raw
        temp = Path(raw)
        try:
            stage = "emulator"
            emulator_process, emulator_serial, emulator_log = start_emulator(temp)
            os.environ["ANDROID_SERIAL"] = emulator_serial
            stage = "packaged-helper"
            bin_dir, helper_version = build_and_install_helper(temp)
            stage = "connected-android-tests"
            remove_android_test_artifacts()
            run(
                [str(ANDROID / "gradlew"), "connectedDebugAndroidTest"],
                cwd=ANDROID,
                timeout=300,
            )
            stage = "android-test-artifact-privacy"
            scan_and_remove_android_test_artifacts()
            stage = "reinstall-a4-test-packages"
            run(
                [str(ANDROID / "gradlew"), "installDebug", "installDebugAndroidTest"],
                cwd=ANDROID,
                capture_output=True,
                timeout=180,
            )
            stage = "a4-live-contract"
            run(["adb", "-s", emulator_serial, "logcat", "-c"])
            stage = "keystore-identity"
            public_key = prepare_public_key(emulator_serial)
            user = pwd.getpwuid(os.getuid()).pw_name
            state, codex_home = temp / "state", temp / "codex-home"
            sessions = write_synthetic_truth(state, codex_home)
            authorized_keys = temp / "authorized_keys"
            authorized_keys.write_text(public_key + "\n", encoding="utf-8")
            authorized_keys.chmod(0o600)
            wrong_key = temp / "wrong-client"
            stage = "disposable-key-material"
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
            malformed_wrapper, oversized_wrapper = temp / "malformed", temp / "oversized"
            write_failure_wrapper(malformed_wrapper, "malformed")
            write_failure_wrapper(oversized_wrapper, "oversized")

            endpoints: dict[str, int] = {}
            stage = "loopback-sshd"
            for name, keys, wrapper in (
                ("normal", authorized_keys, normal_wrapper),
                ("auth", wrong_authorized, normal_wrapper),
                ("malformed", authorized_keys, malformed_wrapper),
                ("oversized", authorized_keys, oversized_wrapper),
            ):
                port = free_port()
                config = temp / f"sshd-{name}.conf"
                write_sshd_config(
                    config,
                    host_key,
                    keys,
                    wrapper,
                    port,
                    user,
                    temp / f"sshd-{name}.pid",
                )
                servers.append(start_sshd(config, temp / f"sshd-{name}.log"))
                endpoints[name] = port

            stage = "foreground-contract"
            flags: list[str] = []
            for key, value in (
                ("a4_host", HOST_ALIAS),
                ("a4_port", endpoints["normal"]),
                ("a4_user", user),
                ("a4_auth_port", endpoints["auth"]),
                ("a4_malformed_port", endpoints["malformed"]),
                ("a4_oversized_port", endpoints["oversized"]),
            ):
                flags.extend(["-e", key, str(value)])
            instrument_with_transitions(emulator_serial, flags, state, sessions)
            results.update(
                {
                    "first_fingerprint_review_and_exact_pin": "passed",
                    "android_keystore_authentication": "passed",
                    "state_grouping_archive_and_bounded_preview": "passed",
                    "fresh_attention_baseline": "passed",
                    "waiting_approval_attention_and_navigation": "passed",
                    "running_to_done_attention_and_navigation": "passed",
                    "background_disconnect_cleanup": "passed",
                    "reconnect_current_state_without_replay": "passed",
                    "authentication_failure_sanitized": "passed",
                    "malformed_frame_failure": "passed",
                    "oversized_frame_failure": "passed",
                }
            )

            normal_server, normal_handle = servers.pop(0)
            stage = "host-key-mismatch"
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
                endpoints["normal"],
                user,
                temp / "sshd-replacement.pid",
            )
            replacement, replacement_handle = start_sshd(
                replacement_config, temp / "sshd-replacement.log"
            )
            servers.append((replacement, replacement_handle))
            mismatch = run(
                [
                    "adb",
                    "-s",
                    emulator_serial,
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
                    f"{TEST_CLASS}#persisted_pin_rejects_restarted_host",
                    RUNNER,
                ],
                capture_output=True,
            )
            if "OK (1 test)" not in mismatch.stdout:
                raise RuntimeError("a4_host_key_mismatch_instrumentation_failed")
            results["same_endpoint_host_key_mismatch_hard_failure"] = "passed"

            stage = "process-cleanup"
            for server, handle in servers:
                stop_server(server)
                handle.close()
            servers.clear()
            time.sleep(0.3)
            observations = marker.read_text(encoding="utf-8").splitlines()
            if observations.count("process-started") < 2:
                raise RuntimeError("packaged_command_observation_incomplete")
            if observations.count("process-stopped") != observations.count("process-started"):
                raise RuntimeError("foreground_process_cleanup_incomplete")

            stage = "privacy-negative-scan"
            app_data = app_private_bytes(emulator_serial).decode("utf-8", errors="replace")
            logcat = run(
                ["adb", "-s", emulator_serial, "logcat", "-d"], capture_output=True
            ).stdout
            retained_runtime = app_data + logcat
            for canary in (*CANARIES, str(temp)):
                if canary in retained_runtime:
                    raise RuntimeError("a4_privacy_residue_detected")
            results["privacy_negative_scan"] = "passed"
            results["disposable_process_and_material_cleanup"] = "passed"

            stage = "public-result"
            emulator_version = run(
                ["emulator", "-version"], capture_output=True
            ).stdout.splitlines()[0]
            api_level = run(
                ["adb", "-s", emulator_serial, "shell", "getprop", "ro.build.version.sdk"],
                capture_output=True,
            ).stdout.strip()
            ssh_version = subprocess.run(
                ["/usr/sbin/sshd", "-V"], capture_output=True, text=True, timeout=5
            ).stderr.strip().split(",")[0]
            result = {
                "contract": "codex-radar.android-a4-end-to-end-smoke",
                "version": 1,
                "repository_commit": source_commit,
                "helper_version": helper_version,
                "android_app_version": "0.3.0-ux1",
                "android_api": api_level,
                "emulator": emulator_version,
                "avd": AVD,
                "ssh_client": "com.github.mwiede:jsch:2.28.5",
                "ssh_server": ssh_version,
                "host_alias": HOST_ALIAS,
                "operating_system_family": "Darwin",
                "observed_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                "scenarios": results,
                "privacy": {
                    "real_credentials_or_personal_data": False,
                    "raw_frames_or_remote_stderr_retained": False,
                    "screenshots_retained": False,
                    "private_key_exported": False,
                },
                "cleanup": {
                    "disposable_sshd_stopped": True,
                    "temporary_material_selected_for_retention": False,
                    "global_ssh_or_codex_configuration_changed": False,
                },
            }
            print(json.dumps(result, indent=2, sort_keys=True))
        except subprocess.CalledProcessError as exception:
            raise RuntimeError(f"a4_stage_failed:{stage}") from exception
        finally:
            for server, handle in servers:
                stop_server(server)
                handle.close()
            if emulator_process is not None:
                stop_emulator(emulator_process, emulator_serial, emulator_log)
            if previous_android_serial is None:
                os.environ.pop("ANDROID_SERIAL", None)
            else:
                os.environ["ANDROID_SERIAL"] = previous_android_serial
    if Path(temp_path).exists():
        raise RuntimeError("a4_temporary_directory_cleanup_failed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exception:
        message = str(exception)
        if not re.fullmatch(r"a4_[a-z0-9_-]+(?::[a-z0-9_-]+)?", message):
            message = type(exception).__name__
        print(f"a4_smoke_failed:{message}", file=sys.stderr)
        raise SystemExit(1) from None
