# Android A5.1 personal-host pilot evidence

Observed 2026-07-29 on one explicitly authorized physical Android API 36,
arm64-v8a device. USB ADB controlled the pilot UI only; the production app
connected over the ordinary local network to one user-selected, existing
POSIX SSH host.

- Source under test: `4f758c2891298835587603be884c6573f0a32299`.
- Android: physical device, API 36, arm64-v8a, app `0.2.0-a3.1`.
- Host: existing OpenSSH `10.2p1` service with a reviewed RSA SHA-2 host key.
- Client: production `com.github.mwiede:jsch:2.28.5` A3.1 transport.
- Helper: installed runtime `0.4.12`, launched by the exact non-PTY request
  `codex-radar mobile rpc`.

The production UI created one host profile and one non-exportable Android
Keystore EC P-256 identity. The app stopped before authentication for unknown
host review. The displayed algorithm, SHA-256 fingerprint, and host-key blob
were independently matched to the selected host before the exact pin was
accepted.

The foreground connection then rendered real read-only Radar state grouped by
project, opened a bounded memory-only preview, established a fresh attention
baseline, and returned no replayed attention on explicit polling or reconnect.
An attention transition was not artificially induced because doing so would
have required changing real remote session state outside this read-only pilot.
Explicit disconnect and reconnect both passed using the retained profile,
host pin, and app-generated identity.

The app-data check found two shared-preference files and no ordinary files,
databases, or cache files. It found no persisted preview/session/message
markers and no app log residue after the bounded run. The approved production
profile, host pin, Android Keystore identity, matching public-key
authorization, and the host-side noninteractive helper PATH fix were
intentionally retained so the user can continue using the pilot. No SSH
service, firewall, provider, network, or global SSH configuration was changed.

During evidence collection, one diagnostic combined a redacted UI hierarchy
with accessibility diagnostic logs that contained bounded preview fragments.
The device-side hierarchy file and log buffer were immediately cleared, and
no preview content was copied into repository or task evidence. This was an
operator evidence-handling incident, not an app persistence or remote-write
failure; it remains separately reviewable and does not broaden this pilot's
claims.

Machine-readable evidence is
[`android-a5-1-personal-host-result.json`](android-a5-1-personal-host-result.json).

This evidence proves one personal foreground read-only pilot on the tested
device, host, network, and source commit. It does not establish release
signing, APK/AAB/store delivery, public Android support, background execution,
push/notification behavior, multi-host support, durable migration or backup,
remote writes, Ed25519 support, or a public release.

The user accepted the basic foreground workflow on 2026-07-29 while explicitly
noting that its UX still needs improvement. That UX finding is a separate
follow-up and does not weaken the accepted A5.1 trust, read-only, privacy, or
foreground-function boundary. Signing, distribution, and UX implementation
remain separately authorized work.
