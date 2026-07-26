# Android A5.0 physical-device smoke evidence

Observed 2026-07-27 on one explicitly authorized physical Android API 36,
arm64-v8a device over an existing paired-wireless ADB connection. The ADB
transport controlled the harness only; `adb reverse` connected the app to
loopback-bound disposable user-mode SSH servers and synthetic Radar/Codex
state.

- Source under test: `b90bba2cbc60418be2175b85e35ee9f89b4d5b60`.
- Android: physical device, API 36, arm64-v8a, app `0.2.0-a3.1`.
- Host: OpenSSH `10.2p1` bound only to development-host loopback.
- Client: production `com.github.mwiede:jsch:2.28.5` A3.1 transport with the
  accepted RSA SHA-2/ECDSA P-256 boundary.
- Helper: source wheel `0.4.12` built into a helper bundle, installed through
  the packaged helper installer in a disposable root, and launched by the
  exact non-PTY request `codex-radar mobile rpc`.

The run passed debug installation and launch, non-exportable Android Keystore
identity and public-only authorization, unknown-host review and exact pinning,
Attention-first state/project grouping, archive separation, bounded
memory-only preview, foreground attention navigation, background disconnect,
fresh reconnect without replay, sanitized authentication/protocol/frame
failures, remote EOF cleanup, forced SSH-loss cleanup, same-host-key reconnect,
and changed-host-key hard failure.

A same-debug-signing-identity replace preserved the profile, exact host pin,
and app-generated Android Keystore identity on this tested device and API. The
identity remained usable for a fresh connection after replacement. This is a
bounded observation, not a durable migration, backup, release-signing, or
production-update guarantee.

The harness retained no device identifier, wireless endpoint, pairing data,
model-specific name, fingerprint, key, username, port, raw protocol frame,
remote stderr, transcript, screenshot, app data, or temporary path. It removed
the debug app and test package, app profile and Keystore identity, every
harness-owned reverse mapping, disposable SSH process and data, helper install,
and synthetic state. An independent post-run check confirmed both packages
absent and zero reverse mappings. The existing wireless ADB pairing was not
revoked or changed.

Acceptance commands:

```sh
PYTHONPATH=src python3 -m unittest discover
python3 -m compileall src tests
cd apps/android
python3 tools/check_fixture_drift.py --check
python3 tools/privacy_negative_check.py
./gradlew testDebugUnitTest lintDebug assembleDebug compileDebugAndroidTestKotlin
./gradlew app:dependencies --configuration debugRuntimeClasspath
python3 tools/run_a5_smoke.py
```

The repository suite passed 189 Python tests with 5 expected skips, compileall,
fixture drift and privacy guards, Android JVM tests, lint, debug build,
Android-test compilation, physical connected instrumentation, dependency
inspection, and the complete A5.0 run.

Machine-readable evidence is
[`android-a5-physical-device-result.json`](android-a5-physical-device-result.json).

This evidence proves only the tested physical-device and paired-wireless ADB
harness boundary. It does not prove ordinary Wi-Fi/VPN/Internet SSH
reachability, a production or personal host, durable update behavior, release
signing, APK/AAB/store delivery, public Android support, background/push
behavior, remote writes, Ed25519 support, Native Windows completion, or a
public release.
