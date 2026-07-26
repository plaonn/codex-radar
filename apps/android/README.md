# Android foreground cockpit (A3.1)

This native Android cockpit owns one foreground-only SSH connection to one
immutable selected profile and launches the exact non-PTY command
`codex-radar mobile rpc`. It has no background service, notifications, remote
writes, listener, raw transcript access, or preview persistence.

The production transport uses `com.github.mwiede:jsch:2.28.5` (Revised BSD).
Its bundled JZlib code is Revised BSD and jBCrypt code is ISC; see
`THIRD_PARTY_NOTICES.md`. Runtime dependency inspection must remain free of
Bouncy Castle. The session-local host-key allowlist is RSA SHA-2 and ECDSA
P-256. Ed25519-only hosts fail before authentication as
`unsupported_host_key`.

Each profile owns an AndroidKeyStore EC P-256 identity. The private key is
non-exportable; the UI exposes only the OpenSSH public key. First contact shows
the presented algorithm plus SHA-256 fingerprint, then persists the exact
algorithm, digest, and key blob only after approval. A mismatch is a hard
failure. Repair explicitly removes the pin and requires a fresh review.

JSONL is strict UTF-8, capped at 1 MiB per frame, and protocol data remains in
memory. Stderr is drained immediately and discarded with an 8 KiB diagnostic
cap before protocol initialization. Backgrounding, disconnect, EOF, and SSH
loss close all resources. Reconnect creates fresh SSH/RPC state and does not
replay missed attention events.

The deterministic A2 fixture remains available only through the explicit
instrumentation intent extra `dev.codexradar.FIXTURE_MODE`.

## Verification

```sh
cd apps/android
python3 tools/check_fixture_drift.py --check
python3 tools/privacy_negative_check.py
./gradlew testDebugUnitTest lintDebug assembleDebug compileDebugAndroidTestKotlin
./gradlew connectedDebugAndroidTest
./gradlew app:dependencies --configuration debugRuntimeClasspath
```

The final A4 end-to-end harness owns a clean local emulator, builds and installs
the source helper wheel through the disposable packaged-helper installer, and
uses only loopback-bound user-mode SSH servers plus synthetic Radar/Codex state:

```sh
cd apps/android
python3 tools/run_a4_smoke.py
```

It requires the `Medium_Phone_API_36.1` AVD, `adb`, `emulator`, `uv`,
`ssh-keygen`, and `/usr/sbin/sshd`. It refuses to share an already-running
Android device and always removes its emulator, SSH processes, keys, installed
helper, and synthetic state.

The bounded A5.0 physical-device harness accepts exactly one explicitly
authorized hardware device over USB ADB or an existing paired wireless ADB
connection:

```sh
cd apps/android
python3 tools/run_a5_smoke.py
```

It refuses pre-existing debug app packages, uses `adb reverse` only for
device-to-loopback test routing, and removes only its own reverse mappings,
packages, app state, SSH processes, and synthetic data. It never revokes an
existing wireless pairing. Public output omits the device serial, wireless
endpoint, model name, host username, paths, ports, fingerprints, and key
material. A paired-wireless run proves the physical-device boundary only; it
does not prove ordinary Wi-Fi, VPN, or Internet SSH reachability.
