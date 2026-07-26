#!/usr/bin/env python3
"""Disposable emulator/loopback acceptance for the A3.1 production transport."""

from __future__ import annotations

import json
import os
import pwd
import re
import shlex
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ANDROID = ROOT / "apps" / "android"
RUNNER = "dev.codexradar.cockpit.test/androidx.test.runner.AndroidJUnitRunner"
TEST = (
    "dev.codexradar.cockpit.A31ProductionTransportTest"
    "#production_pin_exec_protocol_reconnect_and_cleanup"
)
HOST_FAMILIES = {
    "rsa-sha2": ("rsa", "3072"),
    "ecdsa-sha2-nistp256": ("ecdsa", "256"),
    "ssh-ed25519": ("ed25519", ""),
}


def run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, check=True, text=True, **kwargs)


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def descendants(parent: int) -> list[int]:
    lines = subprocess.run(
        ["ps", "-axo", "pid=,ppid="], check=True, capture_output=True, text=True
    ).stdout.splitlines()
    by_parent: dict[int, list[int]] = {}
    for line in lines:
        pid, ppid = (int(value) for value in line.split())
        by_parent.setdefault(ppid, []).append(pid)
    found: list[int] = []
    pending = list(by_parent.get(parent, []))
    while pending:
        pid = pending.pop()
        found.append(pid)
        pending.extend(by_parent.get(pid, []))
    return found


def stop_server(server: subprocess.Popen[str]) -> None:
    for pid in descendants(server.pid):
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    if server.poll() is None:
        server.terminate()
    try:
        server.wait(timeout=3)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait(timeout=3)


def write_wrapper(
    path: Path, venv: Path, state: Path, codex_home: Path, marker: Path
) -> None:
    path.write_text(
        "\n".join(
            [
                "#!/bin/sh",
                'test "${SSH_ORIGINAL_COMMAND:-}" = "codex-radar mobile rpc" || exit 64',
                'test -z "${SSH_TTY:-}" || exit 65',
                f"printf '%s\\n' exact-command-no-pty >> {shlex.quote(str(marker))}",
                f"export CODEX_RADAR_HOME={shlex.quote(str(state))}",
                f"export CODEX_HOME={shlex.quote(str(codex_home))}",
                f"exec {shlex.quote(str(venv / 'bin' / 'codex-radar'))} mobile rpc",
                "",
            ]
        ),
        encoding="utf-8",
    )
    path.chmod(0o700)


def write_protocol_wrapper(path: Path, mode: str) -> None:
    lines = [
        "#!/bin/sh",
        'test "${SSH_ORIGINAL_COMMAND:-}" = "codex-radar mobile rpc" || exit 64',
        'test -z "${SSH_TTY:-}" || exit 65',
        "IFS= read -r _request || exit 66",
    ]
    if mode == "invalid-initialize":
        lines.append(
            """printf '%s\n' '{"id":1,"error":{"code":"unsupported_protocol_version"}}'"""
        )
    else:
        lines.extend(
            [
                """printf '%s\n' '{"id":1,"result":{"protocol":"codex-radar.read-protocol","version":1,"preview_contract_version":2,"attention_delivery":"foreground-poll"}}'""",
                "IFS= read -r _request || exit 66",
                """printf '%s\n' '{"id":2,"result":{"contract":"codex-radar.display-state","version":1,"sessions":[]}}'""",
                "IFS= read -r _request || exit 66",
                """printf '%s\n' '{"id":3,"result":{"events_emitted":0}}'""",
            ]
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    path.chmod(0o700)


def write_sshd_config(
    path: Path,
    host_key: Path,
    authorized_keys: Path,
    wrapper: Path,
    port: int,
    user: str,
    pid_file: Path,
) -> None:
    path.write_text(
        "\n".join(
            [
                f"Port {port}",
                "ListenAddress 127.0.0.1",
                f"HostKey {host_key}",
                f"PidFile {pid_file}",
                f"AuthorizedKeysFile {authorized_keys}",
                f"AllowUsers {user}",
                "StrictModes no",
                "PubkeyAuthentication yes",
                "AuthenticationMethods publickey",
                "PasswordAuthentication no",
                "KbdInteractiveAuthentication no",
                "UsePAM no",
                "PermitRootLogin no",
                "PermitTTY no",
                "AllowTcpForwarding no",
                "AllowAgentForwarding no",
                "X11Forwarding no",
                "PermitTunnel no",
                "PermitUserRC no",
                "UseDNS no",
                "LogLevel VERBOSE",
                f"ForceCommand {wrapper}",
                "",
            ]
        ),
        encoding="utf-8",
    )


def start_sshd(config: Path, log: Path) -> tuple[subprocess.Popen[str], object]:
    handle = log.open("w+", encoding="utf-8")
    run(["/usr/sbin/sshd", "-t", "-f", str(config)])
    server = subprocess.Popen(
        ["/usr/sbin/sshd", "-D", "-e", "-f", str(config)],
        stdout=subprocess.DEVNULL,
        stderr=handle,
        text=True,
    )
    port = int(
        next(
            line.split()[1]
            for line in config.read_text(encoding="utf-8").splitlines()
            if line.startswith("Port ")
        )
    )
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if server.poll() is not None:
            raise RuntimeError("disposable_sshd_start_failed")
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                return server, handle
        except OSError:
            time.sleep(0.05)
    raise RuntimeError("disposable_sshd_not_listening")


def interrupt_after_auth(server: subprocess.Popen[str], log: Path) -> None:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if "Accepted publickey" in log.read_text(encoding="utf-8", errors="replace"):
            time.sleep(0.2)
            for pid in descendants(server.pid):
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            return
        time.sleep(0.05)


def prepare_public_key() -> str:
    completed = run(
        [
            "adb", "shell", "am", "instrument", "-w", "-r", "-e", "class",
            (
                "dev.codexradar.cockpit.A31ProductionTransportTest"
                "#prepare_non_exportable_keystore_key"
            ),
            RUNNER,
        ],
        capture_output=True,
    )
    match = re.search(
        r"a31_public_key_openssh=(ecdsa-sha2-nistp256 [A-Za-z0-9+/=]+ [^\s]+)",
        completed.stdout,
    )
    if not match:
        raise RuntimeError("keystore_public_key_not_emitted")
    return match.group(1)


def main() -> int:
    run([str(ANDROID / "gradlew"), "installDebug", "installDebugAndroidTest"], cwd=ANDROID)
    run(["adb", "logcat", "-c"])
    public_key = prepare_public_key()
    user = pwd.getpwuid(os.getuid()).pw_name
    results: dict[str, str] = {}
    with tempfile.TemporaryDirectory(prefix="codex-radar-a31-") as raw:
        temp = Path(raw)
        venv, state, codex_home = temp / "venv", temp / "state", temp / "codex-home"
        state.mkdir()
        codex_home.mkdir()
        transcript = codex_home / "sessions" / "rollout-session-approval.jsonl"
        transcript.parent.mkdir()
        transcript.write_text(
            "\n".join(
                json.dumps(value)
                for value in (
                    {"role": "user", "content": [{"text": "synthetic question"}]},
                    {"role": "assistant", "content": [{"text": "synthetic answer"}]},
                )
            ) + "\n",
            encoding="utf-8",
        )
        synthetic_state = json.loads(
            (ROOT / "examples" / "sessions.json").read_text(encoding="utf-8")
        )
        for session in synthetic_state["sessions"].values():
            session["transcript_path"] = str(transcript)
        (state / "sessions.json").write_text(
            json.dumps(synthetic_state),
            encoding="utf-8",
        )
        run([sys.executable, "-m", "venv", str(venv)])
        run([str(venv / "bin" / "pip"), "install", "--no-deps", str(ROOT)])
        authorized_keys = temp / "authorized_keys"
        authorized_keys.write_text(public_key + "\n", encoding="utf-8")
        authorized_keys.chmod(0o600)
        marker = temp / "command-observations"
        wrapper = temp / "forced-command"
        write_wrapper(wrapper, venv, state, codex_home, marker)
        wrong_key = temp / "wrong-client"
        run(["ssh-keygen", "-q", "-N", "", "-t", "ecdsa", "-b", "256", "-f", str(wrong_key)])
        wrong_authorized_keys = temp / "wrong_authorized_keys"
        wrong_authorized_keys.write_text(
            wrong_key.with_suffix(".pub").read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        wrong_authorized_keys.chmod(0o600)
        invalid_wrapper = temp / "invalid-protocol-command"
        immediate_wrapper = temp / "immediate-eof-command"
        write_protocol_wrapper(invalid_wrapper, "invalid-initialize")
        write_protocol_wrapper(immediate_wrapper, "immediate-eof")

        for family, (kind, bits) in HOST_FAMILIES.items():
            host_key = temp / f"host-{kind}"
            keygen = ["ssh-keygen", "-q", "-N", "", "-t", kind, "-f", str(host_key)]
            if bits:
                keygen[4:4] = ["-b", bits]
            run(keygen)
            normal_port, loss_port = free_port(), free_port()
            configs = []
            for suffix, port in (("normal", normal_port), ("loss", loss_port)):
                config = temp / f"sshd-{kind}-{suffix}.conf"
                write_sshd_config(
                    config, host_key, authorized_keys, wrapper, port, user,
                    temp / f"sshd-{kind}-{suffix}.pid",
                )
                configs.append(config)
            normal, normal_handle = start_sshd(configs[0], temp / f"{kind}-normal.log")
            loss_log = temp / f"{kind}-loss.log"
            loss, loss_handle = start_sshd(configs[1], loss_log)
            if family != "ssh-ed25519":
                threading.Thread(
                    target=interrupt_after_auth, args=(loss, loss_log), daemon=True
                ).start()
            extra_servers: list[tuple[subprocess.Popen[str], object]] = []
            extra_arguments: list[str] = []
            if family == "rsa-sha2":
                for name, keys, selected_wrapper, extra_line in (
                    ("auth", wrong_authorized_keys, wrapper, None),
                    ("process", authorized_keys, wrapper, "MaxSessions 0"),
                    ("protocol", authorized_keys, invalid_wrapper, None),
                    ("immediate", authorized_keys, immediate_wrapper, None),
                ):
                    extra_port = free_port()
                    extra_config = temp / f"sshd-rsa-{name}.conf"
                    write_sshd_config(
                        extra_config,
                        host_key,
                        keys,
                        selected_wrapper,
                        extra_port,
                        user,
                        temp / f"sshd-rsa-{name}.pid",
                    )
                    if extra_line:
                        extra_config.write_text(
                            extra_config.read_text(encoding="utf-8") + extra_line + "\n",
                            encoding="utf-8",
                        )
                    extra_servers.append(
                        start_sshd(extra_config, temp / f"rsa-{name}.log")
                    )
                    extra_arguments.extend([f"a31_{name}_port", str(extra_port)])
            try:
                argument_flags: list[str] = []
                for index in range(0, len(extra_arguments), 2):
                    argument_flags.extend(
                        ["-e", extra_arguments[index], extra_arguments[index + 1]]
                    )
                completed = subprocess.run(
                    [
                        "adb", "shell", "am", "instrument", "-w", "-r",
                        "-e", "a31_host", "10.0.2.2",
                        "-e", "a31_port", str(normal_port),
                        "-e", "a31_loss_port", str(loss_port),
                        "-e", "a31_user", user,
                        *argument_flags,
                        "-e", "class", TEST, RUNNER,
                    ],
                    text=True,
                    capture_output=True,
                )
                if "OK (1 test)" in completed.stdout:
                    results[family] = "passed"
                elif (
                    "unknown host did not reach review boundary: "
                    "Failed(code=unsupported_host_key)"
                ) in completed.stdout:
                    results[family] = "failed_before_authentication:unsupported_host_key"
                else:
                    print(completed.stdout, file=sys.stderr)
                    raise RuntimeError(f"{family}_instrumentation_failed")
            finally:
                stop_server(normal)
                stop_server(loss)
                for extra_server, extra_handle in extra_servers:
                    stop_server(extra_server)
                    extra_handle.close()
                normal_handle.close()
                loss_handle.close()

        observations = marker.read_text(encoding="utf-8").splitlines()
        if len(observations) != 6 or set(observations) != {"exact-command-no-pty"}:
            raise RuntimeError("exact_command_observation_incomplete")
        expected = {
            "rsa-sha2": "passed",
            "ecdsa-sha2-nistp256": "passed",
            "ssh-ed25519": "failed_before_authentication:unsupported_host_key",
        }
        if results != expected:
            raise RuntimeError(f"host_key_matrix_failed:{results}")
        app_data = subprocess.run(
            [
                "adb", "shell",
                "run-as dev.codexradar.cockpit sh -c "
                "'for f in shared_prefs/* files/* databases/*; do "
                '[ -f \"$f\" ] && cat \"$f\"; done; exit 0\'',
            ],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        logcat = run(["adb", "logcat", "-d"], capture_output=True).stdout
        prohibited = (
            "synthetic question",
            "synthetic answer",
            str(temp),
            '"protocol_versions"',
            '"method":"preview/read"',
            "PRIVATE KEY",
        )
        for marker_value in prohibited:
            if marker_value in app_data or marker_value in logcat:
                raise RuntimeError("production_privacy_residue_detected")
        print(json.dumps({
            "contract": "codex-radar.android-a3.1-production-smoke",
            "version": 1,
            "dependency": "com.github.mwiede:jsch:2.28.5",
            "host_key_matrix": results,
            "scenarios": {
                "keystore_ec_p256_non_exportable": "passed",
                "exact_pin_reconnect_and_mismatch": "passed",
                "exact_command_without_pty": "passed",
                "protocol_initialize_state_preview_attention_baseline": "passed",
                "remote_eof_explicit_close_ssh_loss": "passed",
                "immediate_eof_terminal_order": "passed",
                "sanitized_auth_process_protocol_failures": "passed",
                "production_app_data_and_logcat_negative_scan": "passed",
            },
            "privacy": {
                "real_credentials_or_data": False,
                "private_key_exported": False,
                "stderr_retained": False,
            },
        }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
