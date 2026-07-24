# Android fixture cockpit (A2)

This is the fixture-only A2 shell for the foreground, read-only Radar cockpit.
It does not contain SSH, credentials, host trust, a process launcher, a network
listener, a background service, notifications, remote writes, logging, or
preview persistence. A3 owns SSH and credential work under a separate contract.

## Stack

- Kotlin + native platform Views: small, account-free Android surface.
- `minSdk 26`: covers supported platform APIs without compatibility UI layers.
- `compileSdk 36`, `targetSdk 35`: installed SDK compatible build baseline.
- Kotlin and AndroidX test libraries are Apache-2.0; JUnit 4 is EPL-1.0.
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
```

`connectedDebugAndroidTest` requires a locally booted emulator. The app's
fixture profile is presentation-only and deliberately cannot connect to a host.
