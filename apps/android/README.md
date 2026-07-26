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
