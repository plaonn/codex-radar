# Android Physical-Device Pilot A5

## Decision

The first post-MVP Android use gate is split into two separately accepted
packages:

1. **A5.0 physical-device compatibility smoke** uses a USB-connected Android
   device, `adb reverse`, and a disposable loopback-only SSH host with synthetic
   Radar state.
2. **A5.1 personal-host pilot** uses one user-selected existing POSIX SSH host
   only after A5.0 is accepted and the user separately authorizes the real-host
   actions.

Android signing, durable APK distribution, store publication, background
operation, remote writes, and public device-support claims are not part of A5.

## Root Outcome

Prove, before asking the user to trust a personal host or credential boundary,
that the accepted M4A app works on an actual Android device:

- the debug app installs and launches;
- the app-generated Android Keystore identity remains non-exportable;
- explicit host-key review and exact pinning work;
- the production foreground SSH transport launches exact non-PTY
  `codex-radar mobile rpc`;
- state, bounded preview, attention, background cleanup, and reconnect behave
  as accepted;
- no private path, credential, transcript, raw frame, or remote diagnostic is
  retained in public evidence or persisted app state.

After that compatibility proof is accepted, A5.1 may establish whether the same
read-only foreground workflow is useful against one real user-owned host.

## Ordered Gate

```text
M4A accepted emulator evidence
  -> A5.0 USB physical-device smoke
  -> explicit A5.0 acceptance
  -> fresh user authorization and host selection
  -> A5.1 personal-host read-only pilot
  -> separate A6 signing/distribution decision, if still wanted
```

Completing one stage never authorizes the next stage.

## A5.0: USB Physical-Device Compatibility Smoke

### Entry Conditions

- M4A remains accepted with no unresolved Android transport or privacy
  regression.
- The user connects one compatible Android device by USB, enables USB
  debugging, accepts the workstation authorization prompt, and explicitly
  starts the bounded device run.
- The harness resolves exactly one hardware device and fails closed when there
  are zero or multiple eligible devices.
- No other Android or ADB writer owns the same device.

The user does not need to publish a device serial, account, hostname,
fingerprint, or personal path.

### Disposable Topology

```text
physical Android device
  -> USB adb reverse tcp:<device-port> tcp:<host-port>
  -> development-host loopback
  -> disposable user-mode sshd
  -> exact non-PTY command: codex-radar mobile rpc
  -> temporary CODEX_RADAR_HOME and CODEX_HOME
  -> synthetic sessions.json and synthetic transcript
```

- Bind the disposable SSH server only to host loopback on an ephemeral port.
- Map a device-local test port to that loopback port with `adb reverse`.
- Configure the temporary app profile for `127.0.0.1:<device-port>`.
- Generate server keys, `authorized_keys`, configuration, Radar state, and
  transcript fixtures in one disposable directory.
- Use the installed helper runtime `0.4.12` and the production JSch `2.28.5`
  transport.
- Stop the SSH process, remove the reverse mapping and disposable directory,
  clear the debug app, and release the device on success or failure.

The harness must not enable system Remote Login, bind a LAN or public
interface, edit global SSH or firewall configuration, use the operator's
default Codex/Radar state, or require elevated privileges.

### Installation Boundary

- Build the current debug APK with the normal Android debug signing identity.
- Install or replace only the debug application on the exact USB device.
- Do not generate, import, or request a release signing key.
- Do not upload or distribute the APK.
- Exercise a same-identity debug replace/update to observe profile and
  Android Keystore continuity; record the result instead of assuming it.
- Treat uninstall as destructive to app-scoped state and identity. A later
  production migration or backup contract requires separate design.

### Required Evidence

1. **Install and launch**
   - device is selected without retaining its serial;
   - the debug app installs, starts, and reaches the profile screen.
2. **Identity and trust**
   - Android Keystore EC P-256 private material remains non-exportable;
   - public-key export is usable by the disposable SSH host;
   - unknown host stops before authentication, exact fingerprint approval
     connects, and a changed host key hard-fails.
3. **Foreground product flow**
   - initialize, state, Attention-first/project grouping, bounded preview, and
     foreground attention use the packaged helper and production transport.
4. **Lifecycle**
   - backgrounding closes the connection and attention delivery;
   - foreground reconnect starts a new process and baseline without replay;
   - remote EOF and forced SSH loss leave no active channel or stale preview.
5. **Replace/update observation**
   - a same-debug-identity replace records whether profile, pin, and app key
     remain usable on the tested device/API;
   - any failure is classified without weakening identity or trust checks.
6. **Privacy and cleanup**
   - app storage and logcat scans contain no prohibited canaries;
   - public-safe evidence excludes serial, model-specific personal names,
     username, paths, ports, fingerprints, keys, raw frames, and transcript;
   - reverse mapping, disposable SSH process/data, test app data, and temporary
     packages are removed.

### A5.0 Acceptance

A5.0 is complete only when one physical-device run passes the required
scenarios, local repository verification remains green, evidence is tied to an
exact commit and Android API/ABI, cleanup is independently checked, and the
parent explicitly accepts the result.

A5.0 proves physical-device compatibility only for the tested boundary. It
does not prove ordinary Wi-Fi/VPN/Internet reachability, a production host,
durable update behavior, public Android support, signing, or publication.

## A5.1: Personal-Host Read-Only Pilot

### Entry and User-Owned Actions

A5.1 remains unclaimed until A5.0 is accepted and the user separately:

- selects one already reachable, user-owned POSIX SSH host;
- confirms a safe pilot window and the host's supported RSA SHA-2 or ECDSA
  P-256 host key;
- installs or confirms helper runtime `0.4.12`;
- copies the app-generated public key into the selected account's
  `authorized_keys`;
- independently verifies the host-key algorithm and SHA-256 fingerprint before
  accepting the pin in the app.

If the host lacks an existing safe SSH service, stop. A5.1 does not authorize
enabling Remote Login, opening a firewall, changing provider/network policy,
creating an account, or automating host credential configuration.

### Pilot Boundary

- one host profile and one foreground connection at a time;
- key authentication only, with no password capture or fallback;
- exact non-PTY `codex-radar mobile rpc`;
- state, bounded redacted preview, foreground attention, disconnect, and
  reconnect only;
- no thread message, approval, archive, rename, command input, or other remote
  write;
- no background service, push, notification, analytics, crash upload, or
  persistent preview;
- private evidence only where necessary, with no hostname, username, address,
  path, fingerprint, session content, or credential committed to the
  repository.

### A5.1 Acceptance

A5.1 is complete when the user can perform the bounded foreground read flow on
the chosen host, the trust and cleanup contracts hold, and the user explicitly
accepts the workflow as useful enough to consider a distribution path.

This result remains a personal pilot, not a public support or release claim.

## Deferred A6: Signing and Distribution

Only after A5.1 acceptance should a separate proposal decide:

- release-signing key ownership, custody, backup, and rotation;
- application ID, versioning, upgrade, rollback, and uninstall semantics;
- a private APK channel versus managed or store distribution;
- artifact integrity, revocation, privacy notice, and support scope.

No release key, signed APK/AAB, upload, store account, or publication task is
authorized by this A5 design.

## Decision Ownership

- The user owns device access, USB-debugging authorization, real-host
  selection, host configuration, fingerprint acceptance, signing keys,
  distribution accounts, and any support or publication commitment.
- Codex may prepare and run the disposable A5.0 harness only after its entry
  conditions are satisfied and an exact task is claimed.
- A5.1 requires a new exact task and fresh user authorization even after A5.0
  succeeds.
