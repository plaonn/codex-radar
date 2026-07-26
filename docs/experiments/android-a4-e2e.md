# Android A4 end-to-end smoke evidence

Observed 2026-07-26 on a fresh, wipe-data Android API 36 emulator against only
loopback-bound disposable user-mode SSH servers and synthetic Radar/Codex
state.

- Source under test: `d48555314fcf9083e34d38fcd321f74043b9715f`.
- Android: `Medium_Phone_API_36.1`, emulator `36.1.9.0`, app
  `0.2.0-a3.1`.
- Host: OpenSSH `10.2p1` on loopback, reached only through the documented
  emulator alias `10.0.2.2`.
- Client: production `com.github.mwiede:jsch:2.28.5` A3.1 transport with the
  accepted RSA SHA-2/ECDSA P-256 boundary.
- Helper: source wheel `0.4.12` built into a helper bundle, installed through
  the packaged helper installer in a disposable root, and launched by the
  exact non-PTY request `codex-radar mobile rpc`.

The run passed first fingerprint review and exact pin persistence,
non-exportable Android Keystore authentication, Attention-first state/project
grouping and archive separation, bounded memory-only preview, baseline-only
first poll, new `waiting_approval` and `running`-to-`done` navigation,
background cleanup, reconnect without replay, same-endpoint host-key mismatch,
authentication failure, malformed and oversized inbound frames, privacy
negative scans, and cleanup.

The harness retained no fingerprint, key, username, port, raw protocol frame,
remote stderr, transcript text, screenshot, app data, or temporary path.
Every disposable SSH process, packaged-helper install, key, synthetic state
directory, and emulator was removed. It did not change system SSH, firewall,
Remote Login, an OS user, global Codex configuration, provider state, or any
real Radar/Codex data.

Generic connected tests gate disposable public-key status export. Their result
artifacts are scanned for key/status and privacy canaries, then removed before
the live contract proceeds. Injected failure tests also verify cleanup when
emulator or SSH startup fails, instrumentation exceeds its deadline or
transition processing fails, an app-storage scan times out, or an artifact
privacy scan rejects retained output.

Acceptance commands:

```sh
cd apps/android
python3 tools/check_fixture_drift.py --check
python3 tools/privacy_negative_check.py
./gradlew testDebugUnitTest lintDebug assembleDebug compileDebugAndroidTestKotlin
python3 tools/run_a4_smoke.py
cd ../..
PYTHONPATH=src python3 -m unittest discover
python3 -m compileall src tests
```

Machine-readable evidence is
[`android-a4-e2e-result.json`](android-a4-e2e-result.json).

This evidence does not claim a physical-device result, Android signing or
publication readiness, APK/AAB/store delivery, background or push behavior,
remote writes, Ed25519 support, Native Windows completion, or a public release.
