# Android fixture cockpit (A2)

The production shell is the fixture-only A2 foreground, read-only Radar
cockpit. It is not wired to SSH, credentials, host trust, a process launcher,
a network listener, a background service, notifications, remote writes,
logging, or preview persistence.

The isolated `a3spike` package and instrumentation tests are the A3.0F
`mwiede/jsch` fallback comparison only. They are not wired into `MainActivity`;
the production UI remains fixture-backed until a separate A3.1 adoption
decision. See `docs/experiments/android-a3f-jsch-compatibility.md` for the
RSA/ECDSA result, honest Ed25519 boundary, and SSHJ comparison.

## Stack

- Kotlin + native platform Views: small, account-free Android surface.
- `minSdk 26`: covers supported platform APIs without compatibility UI layers.
- `compileSdk 36`, `targetSdk 35`: installed SDK compatible build baseline.
- Kotlin and AndroidX test libraries are Apache-2.0; JUnit 4 is EPL-1.0.
- The isolated A3.0F spike uses `mwiede/jsch` 2.28.5 under Revised BSD/ISC
  notices and adds no transitive runtime dependency.
- AGP `8.10.1` + Gradle `8.11.1` support compile SDK 36 on JDK 17.

`tools/check_fixture_drift.py` derives the runtime asset and JVM-test resource
from the canonical RPC framing plus `display-state-v1` and `transcript-preview-v2`
goldens. `--check` rejects byte/hash drift; the script does not reinterpret
host protocol semantics.

## Commands

```sh
cd apps/android
python3 tools/check_fixture_drift.py        # regenerate after host fixture update
./gradlew checkFixtureDrift                 # verify derived copies only
python3 tools/privacy_negative_check.py
./gradlew test lint assembleDebug
./gradlew connectedDebugAndroidTest
python3 tools/run_a3f_smoke.py             # booted API-36 emulator; disposable loopback sshd
```

`connectedDebugAndroidTest` requires a locally booted emulator. The app's
fixture profile is presentation-only and deliberately cannot connect to a host.
