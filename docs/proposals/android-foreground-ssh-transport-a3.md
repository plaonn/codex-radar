# Android Foreground SSH Transport A3

## Status and Decision

This design is approved for the Android foreground cockpit lineage. It fixes
the credential and trust policy for A3, but it does not claim implementation.
A3 remains dependent on accepted A2 fixture-cockpit completion.

The first implementation candidate is SSHJ `0.40.0`, introduced through a
bounded Android compatibility spike before production transport code is
adopted. The MVP uses only app-generated, non-exportable Android Keystore keys.
Importing an existing private key, storing a software private key, password
authentication, and passphrase-file handling are excluded.

## Root Outcome

While the Android app is visible, it can connect to one user-selected POSIX
host over SSH, authenticate with an app-owned key, execute exactly
`codex-radar mobile rpc`, and exchange the existing read-only JSONL protocol
without opening a listener or gaining remote-write authority.

## Design Lineage and Dependency

- Parent product contract:
  [Android Foreground Cockpit MVP](android-foreground-cockpit-mvp.md)
- Host dependency: accepted helper runtime `0.4.12` with the stable
  `codex-radar mobile rpc` entrypoint and 1 MiB inbound request-frame limit.
- Android dependency: A2 must first provide an accepted fixture-driven
  protocol/domain/UI boundary under `apps/android/`.
- Dependency mode: `wait-for-completion`; read-only design work may run while
  A2 is active, but A3 must not share the `apps/android/` write set with A2.

## SSH Dependency Decision

### Primary Candidate

Use SSHJ `0.40.0` for the first compatibility spike.

Reasons:

- Apache-2.0 licensing;
- explicit public-key authentication, command-channel, and host-key verifier
  APIs;
- a `KeyProvider` abstraction that accepts standard Java `PrivateKey` and
  `PublicKey` objects;
- signing through the standard Java `Signature.initSign(PrivateKey)` boundary,
  which is compatible in shape with Android Keystore signing;
- maintained modern algorithm support and documented Android compatibility
  work.

This is a candidate, not a compatibility claim. Android provider selection,
non-exportable key signing, dependency packaging, and device/emulator behavior
must be proven by A3.0.

### Alternatives

- `mwiede/jsch` is the fallback if SSHJ cannot operate with an Android
  Keystore-backed key or has an unresolved Android provider conflict. Its
  maintained algorithm defaults are useful, but its Android integration
  evidence and documentation are weaker for this use case.
- Apache MINA sshd is rejected for the MVP because its own Android notes say
  active Android support is not a project goal and identify provider and I/O
  uncertainty.
- ConnectBot `cbssh` is not the first MVP dependency because its standalone
  library and exec-channel evidence are not yet mature enough for this critical
  boundary.

No fallback library may silently weaken host verification or credential
storage. Switching to imported or software-stored private keys is a separate
user-owned credential-policy decision.

## Credential Contract

- Generate one EC P-256 key pair per immutable host-profile identity using
  `AndroidKeyStore`.
- The private key must be non-exportable. Application code, fixtures, logs,
  backups, screenshots, and repository artifacts must never contain its
  encoded material.
- Export or display only the OpenSSH-formatted public key so the user can add it
  to the selected host's `authorized_keys`.
- Bind the Keystore alias to the local immutable profile identifier rather than
  mutable host-display text.
- Deleting a profile deletes its app-owned key after an explicit destructive
  confirmation. Editing host, port, or user must not silently transfer trust or
  credential identity to a different endpoint.
- MVP does not require biometric confirmation for every signature. Revisit
  user-authentication gating only when a concrete device-loss or shared-device
  threat requires it.
- Android backup or sync must not be treated as a private-key transfer
  mechanism. A restored profile without its Keystore key requires a new key and
  host-side public-key update.

## Host Trust Contract

1. Connect far enough to obtain the server host key, but do not authenticate or
   launch Radar for an unknown identity.
2. Display host, port, host-key algorithm, and SHA-256 fingerprint.
3. Require the user to compare the fingerprint with a trusted host-side or
   administrator-provided channel before approving it.
4. Persist the exact approved host-key identity for the profile.
5. On later connections, proceed only on an exact match.
6. Treat a changed key as a hard failure. Repair or re-pin is a distinct,
   explicit profile action; it is never an in-place warning bypass.

Blind acceptance, `PromiscuousVerifier`, accept-all callbacks, and automatic
first-use trust are prohibited. First-use fingerprint review is still a manual
trust ceremony, not proof from an independent cryptographic channel, so the UI
must say what the user is expected to verify.

## Foreground Connection and Process Lifecycle

- Open SSH only after an explicit foreground connect action.
- Use one SSH connection and one command channel for one foreground Radar
  session.
- Do not allocate a PTY and do not launch an interactive shell.
- Execute the exact argument-equivalent command
  `codex-radar mobile rpc`; do not interpolate user-controlled shell fragments.
- Treat stdout as JSONL protocol data only and stderr as bounded diagnostic
  input only.
- On app backgrounding, explicit disconnect, EOF, protocol failure, or SSH
  loss, close the command channel and SSH session and stop attention delivery.
- Reconnect with a fresh SSH session and process, then initialize, read current
  state, and establish a new attention baseline. Do not replay missed events.

## Framing and Failure Boundaries

- Preserve the host's 1 MiB inbound JSONL request-frame limit.
- The Android client must also cap each outbound and inbound JSONL frame at
  1 MiB before parsing or buffering unbounded content.
- A malformed, oversized, duplicate-id, or version-incompatible frame fails
  the current connection without partially applying UI state.
- Authentication, host trust, process launch, protocol, and disconnect failures
  map to stable sanitized categories.
- UI and logs must not echo raw requests, preview content, credentials, private
  paths, remote stderr text, or dependency exception strings that contain
  sensitive values.
- Preview failure may remain a bounded per-session error only when the transport
  and current-state stream are still valid; transport or framing failures
  invalidate the connection.

## A3.0 Bounded Compatibility Spike

The first executable A3 package is a bounded experiment, not the full transport
implementation.

It must prove on an Android emulator or device against a disposable POSIX SSH
host:

1. an app-generated, non-exportable Android Keystore EC P-256 key can
   authenticate through SSHJ;
2. an unknown host key stops before authentication, explicit fingerprint
   approval creates a pin, an exact match reconnects, and a changed key fails;
3. a non-PTY command channel executes exactly `codex-radar mobile rpc`;
4. initialize and one deterministic request/response exchange pass through the
   A2 protocol boundary;
5. 1 MiB framing, process cleanup, app background/disconnect, and sanitized
   errors behave as specified;
6. packaged dependencies have compatible licenses and no unresolved Android
   cryptographic-provider conflict.

Stop and return to design if SSHJ cannot sign with the Keystore key, requires an
unsafe provider override, or requires exportable private-key material. The
spike may evaluate `mwiede/jsch` behind the same boundary, but it may not adopt
software-key storage or private-key import without a new user decision.

## A3.1 Adoption Gate

Only after A3.0 passes and its result is accepted may the fixture transport be
replaced or complemented by the foreground SSH transport in the production
Android app. A3.1 must preserve the A2 protocol/domain/UI contracts and add
unit/integration tests for lifecycle, trust, framing, and failure mapping.

## Verification

- Android unit tests cover profile-key lifecycle, host pin persistence,
  mismatch failure, frame limits, sanitized errors, and reconnect state.
- A disposable SSH integration test covers authentication, exact command
  execution, stdout/stderr separation, EOF, and process cleanup.
- An emulator or device smoke proves Android Keystore signing and host-key
  mismatch handling.
- Persisted app data and logs are inspected for private keys, preview content,
  raw requests, remote paths, and unsanitized stderr.
- Existing Android A2 tests, Python tests, and Python compileall remain green.

## Authority and Non-Goals

Codex may select conservative reversible implementation details inside the
bounded spike and may use ordinary account-free open-source dependencies.

The user remains the decision owner for any credential-policy expansion,
production signing/publication, paid service or account, background execution,
biometric requirement, remote write capability, or public support commitment.

A3 does not authorize:

- concurrent writes with active A2 work;
- imported or exportable private keys;
- passwords or keyboard-interactive authentication;
- background service, wake lock, push, or OS notification;
- listener, daemon, proxy, firewall, or host SSH configuration changes;
- PTY, interactive shell, arbitrary remote command, or R12 write RPC;
- Play Store, APK/AAB publication, or production signing;
- `hooks.json`, VSIX, Native Windows, or unrelated repository changes.

## Reference Evidence

- [Android Keystore](https://developer.android.com/privacy-and-security/keystore)
- [Android `KeyGenParameterSpec`](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec)
- [SSHJ](https://github.com/hierynomus/sshj)
- [SSHJ `KeyProvider`](https://github.com/hierynomus/sshj/blob/v0.40.0/src/main/java/net/schmizz/sshj/userauth/keyprovider/KeyProvider.java)
- [SSHJ signature boundary](https://github.com/hierynomus/sshj/blob/v0.40.0/src/main/java/net/schmizz/sshj/signature/AbstractSignature.java)
- [Apache MINA sshd Android notes](https://github.com/apache/mina-sshd/blob/master/docs/android.md)
- [`mwiede/jsch`](https://github.com/mwiede/jsch)
- [ConnectBot `cbssh`](https://github.com/connectbot/cbssh)
