# Android A3.1 production transport evidence

Observed 2026-07-26 on a clean Android API 36 emulator using only temporary EC
P-256 client material, disposable loopback user-mode sshd instances, and
synthetic `sessions.json` state.

- Runtime: `com.github.mwiede:jsch:2.28.5`; dependency graph contains no runtime
  transitive library and no Bouncy Castle provider.
- RSA SHA-2 and ECDSA P-256 completed first-contact review, exact pin approval,
  AndroidKeyStore public-key authentication, exact non-PTY command execution,
  protocol initialize/state, reconnect, mismatch rejection, remote EOF,
  explicit close, and forced SSH-loss cleanup.
- Ed25519-only negotiation returned the stable sanitized
  `unsupported_host_key` category before authentication and executed no forced
  command.
- The private EC P-256 key remained non-exportable; only its OpenSSH public key
  was emitted into temporary `authorized_keys`.
- The smoke retained no real credential, host, Radar state, stderr, exception,
  transcript, preview, or global SSH/Codex configuration.

Acceptance commands:

```sh
cd apps/android
python3 tools/check_fixture_drift.py --check
python3 tools/privacy_negative_check.py
./gradlew testDebugUnitTest lintDebug assembleDebug compileDebugAndroidTestKotlin
./gradlew connectedDebugAndroidTest
./gradlew app:dependencies --configuration debugRuntimeClasspath
python3 tools/run_a31_smoke.py
cd ../..
PYTHONPATH=src python3 -m unittest discover
python3 -m compileall src tests
```

Machine-readable evidence is
[`android-a3-1-production-result.json`](android-a3-1-production-result.json).
A4 execution, Android signing/publication, background behavior, remote writes,
and credential-policy expansion are not claimed.
