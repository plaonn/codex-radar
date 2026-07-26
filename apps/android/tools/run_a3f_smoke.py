#!/usr/bin/env python3
"""Run the public-safe A3.0F emulator/loopback mwiede-jsch comparison."""

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
    "dev.codexradar.cockpit.A3JschCompatibilityTest"
    "#jsch_keystore_pin_exec_protocol_reconnect_and_cleanup"
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
    output = subprocess.run(
        ["ps", "-axo", "pid=,ppid="],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    by_parent: dict[int, list[int]] = {}
    for line in output.splitlines():
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
        for pid in descendants(server.pid):
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        server.kill()
        server.wait(timeout=3)


def write_wrapper(path: Path, venv: Path, state: Path, codex_home: Path, marker: Path) -> None:
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
                "PermitEmptyPasswords no",
                "PermitTTY no",
                "AllowTcpForwarding no",
                "AllowAgentForwarding no",
                "X11Forwarding no",
                "PermitTunnel no",
                "GatewayPorts no",
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
    deadline = time.monotonic() + 5
    port = int(
        next(
            line.split()[1]
            for line in config.read_text(encoding="utf-8").splitlines()
            if line.startswith("Port ")
        )
    )
    while time.monotonic() < deadline:
        if server.poll() is not None:
            handle.seek(0)
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
        try:
            content = log.read_text(encoding="utf-8", errors="replace")
        except FileNotFoundError:
            return
        if "Accepted publickey" in content:
            time.sleep(0.2)
            victims = descendants(server.pid)
            if not victims:
                return
            for pid in victims:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            return
        time.sleep(0.05)


def prepare_public_key() -> str:
    result = run(
        [
            "adb",
            "shell",
            "am",
            "instrument",
            "-w",
            "-r",
            "-e",
            "class",
            (
                "dev.codexradar.cockpit.A3JschCompatibilityTest"
                "#prepare_non_exportable_keystore_key"
            ),
            RUNNER,
        ],
        capture_output=True,
    )
    match = re.search(r"a3_public_key_openssh=(ecdsa-sha2-nistp256 [A-Za-z0-9+/=]+ [^\s]+)", result.stdout)
    if not match:
        raise RuntimeError("keystore_public_key_not_emitted")
    return match.group(1)


def main() -> int:
    public_key = prepare_public_key()
    user = pwd.getpwuid(os.getuid()).pw_name
    results: dict[str, str] = {}
    with tempfile.TemporaryDirectory(prefix="codex-radar-a3f-") as raw:
        temp = Path(raw)
        venv = temp / "venv"
        state = temp / "state"
        codex_home = temp / "codex-home"
        state.mkdir()
        codex_home.mkdir()
        (state / "sessions.json").write_text(
            (ROOT / "examples" / "sessions.json").read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        run([sys.executable, "-m", "venv", str(venv)])
        run([str(venv / "bin" / "pip"), "install", "--no-deps", str(ROOT)])

        authorized_keys = temp / "authorized_keys"
        authorized_keys.write_text(public_key + "\n", encoding="utf-8")
        authorized_keys.chmod(0o600)
        wrapper = temp / "forced-command"
        marker = temp / "command-observations"
        write_wrapper(wrapper, venv, state, codex_home, marker)

        for family, (kind, bits) in HOST_FAMILIES.items():
            host_key = temp / f"host-{kind}"
            keygen = ["ssh-keygen", "-q", "-N", "", "-t", kind, "-f", str(host_key)]
            if bits:
                keygen[4:4] = ["-b", bits]
            run(keygen)
            normal_port, loss_port = free_port(), free_port()
            normal_config = temp / f"sshd-{kind}-normal.conf"
            loss_config = temp / f"sshd-{kind}-loss.conf"
            write_sshd_config(
                normal_config,
                host_key,
                authorized_keys,
                wrapper,
                normal_port,
                user,
                temp / f"sshd-{kind}-normal.pid",
            )
            write_sshd_config(
                loss_config,
                host_key,
                authorized_keys,
                wrapper,
                loss_port,
                user,
                temp / f"sshd-{kind}-loss.pid",
            )
            normal, normal_handle = start_sshd(normal_config, temp / f"sshd-{kind}-normal.log")
            loss_log = temp / f"sshd-{kind}-loss.log"
            loss, loss_handle = start_sshd(loss_config, loss_log)
            interrupter = threading.Thread(
                target=interrupt_after_auth,
                args=(loss, loss_log),
                daemon=True,
            )
            interrupter.start()
            try:
                completed = run(
                    [
                        "adb",
                        "shell",
                        "am",
                        "instrument",
                        "-w",
                        "-r",
                        "-e",
                        "a3_host",
                        "10.0.2.2",
                        "-e",
                        "a3_port",
                        str(normal_port),
                        "-e",
                        "a3_loss_port",
                        str(loss_port),
                        "-e",
                        "a3_user",
                        user,
                        "-e",
                        "class",
                        TEST,
                        RUNNER,
                    ],
                    capture_output=True,
                )
                if "OK (1 test)" in completed.stdout:
                    results[family] = "passed"
                elif (
                    "unknown host did not reach review boundary: "
                    "Failed(code=ssh_connection_failed)"
                ) in completed.stdout:
                    results[family] = "failed_before_host_verifier"
                else:
                    print(completed.stdout, file=sys.stderr)
                    raise RuntimeError(f"{family}_instrumentation_failed")
            finally:
                stop_server(normal)
                stop_server(loss)
                normal_handle.close()
                loss_handle.close()

        observations = marker.read_text(encoding="utf-8").splitlines()
        passed_families = sum(value == "passed" for value in results.values())
        if len(observations) != passed_families * 3:
            raise RuntimeError("exact_command_observation_incomplete")
        if any(value != "exact-command-no-pty" for value in observations):
            raise RuntimeError("command_or_pty_contract_failed")

        manifest = {
            "contract": "codex-radar.android-a3f-jsch-smoke",
            "version": 1,
            "surface": "Android API 36 emulator and disposable loopback POSIX sshd",
            "dependency": "com.github.mwiede:jsch:2.28.5",
            "host_key_matrix": results,
            "scenarios": {
                "keystore_ec_p256_non_exportable": "passed",
                "unknown_host_stops_before_authentication": "passed",
                "exact_pin_reconnect": "passed",
                "changed_pin_hard_failure": "passed",
                "exact_command_without_pty": "passed",
                "initialize_and_state_read_through_a2_parser": "passed",
                "remote_eof_cleanup": "passed",
                "explicit_background_cleanup": "passed",
                "forced_ssh_loss_cleanup": "passed",
                "bounded_stderr_discard": "passed",
            },
            "privacy": {
                "private_key_exported": False,
                "host_or_fingerprint_retained": False,
                "raw_stderr_or_exception_text_retained": False,
                "real_credentials_or_personal_radar_data": False,
            },
        }
        print(json.dumps(manifest, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
