# Android Foreground SSH Transport A3

## Status and Decision

This design is approved for the Android foreground cockpit lineage. It fixes
the credential and trust policy for A3, but it does not claim implementation.
A3 remains dependent on accepted A2 fixture-cockpit completion.

The first implementation candidate was SSHJ `0.40.0`, introduced through a
bounded Android compatibility spike before production transport code was
adopted. That spike proved the credential, trust, process, protocol, lifecycle,
and privacy boundaries on Android, but only with an RSA host key. The accepted
A3.0F fallback comparison then proved the same full boundary with
`mwiede/jsch` `2.28.5` for RSA SHA-2 and ECDSA P-256 host keys without adding
or selecting Bouncy Castle. A3.1 therefore adopts `mwiede/jsch` `2.28.5`.
Ed25519-only hosts are outside the MVP compatibility boundary and must fail
before authentication. The MVP continues to use only app-generated,
non-exportable Android Keystore keys. Importing an existing private key,
storing a software private key, password authentication, and passphrase-file
handling are excluded.

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

### Adopted Dependency

A3.1 uses `com.github.mwiede:jsch:2.28.5`.

The accepted A3.0F comparison established:

- full-boundary success with RSA SHA-2 host keys;
- full-boundary success with `ecdsa-sha2-nistp256` host keys;
- an honest pre-verifier failure for `ssh-ed25519` on Android because the
  multi-release JAR's Java 15 Ed25519 replacement was not selected;
- no JSch transitive runtime dependency and no Bouncy Castle provider
  installation, selection, mutation, or packaging;
- preservation of the Android Keystore identity, exact-pin trust, non-PTY
  command, protocol, framing, stderr, lifecycle, failure-sanitization, and
  privacy contracts.

The MVP supported-host boundary is therefore RSA SHA-2 and ECDSA P-256.
Ed25519-only servers must return a stable sanitized unsupported-host-key
failure before authentication. A3.1 must not add a cryptographic provider or
weaken the verifier to expand that boundary. Revised BSD and bundled Revised
BSD/ISC notices must be retained in the Android distribution materials.

### First Candidate and Rejected Production Boundary

SSHJ `0.40.0` was used for the first compatibility spike.

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

The A3.0 result proves Android provider selection, non-exportable key signing,
dependency packaging, and device/emulator behavior for an RSA-host-key server.
It does not establish general host-key compatibility.

### Alternatives

- SSHJ remains accepted experiment evidence but is not selected for A3.1
  because its verified Android production boundary was RSA-host-key-only.
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

### A3.0 Result and Fallback Disposition

The pushed A3.0 evidence at
`codex/android-keystore-ssh-a3-spike` commits
`30d0c38e946544e54b59f6518dbe9f75dcde02a1` and
`5570ed0b52ac5e0e4d60b8057d395bc7cdcb9849` is accepted as a successful
bounded SSHJ experiment, but not as A3.1 adoption evidence.

On an Android API 36 emulator, SSHJ authenticated with the non-exportable
Keystore EC P-256 key and preserved the exact-pin, non-PTY command, bounded
protocol, cleanup, and privacy contracts when the server presented an RSA host
key. ECDSA host-key parsing failed because SSHJ requested
`KeyFactory("ECDSA")` while Android exposes the relevant factory as `EC`.
Ed25519 also failed before the host-key verifier.

An RSA-only production boundary would be safe when the selected host already
offers a compatible RSA host key, but it would narrow the root outcome's
user-selected POSIX-host compatibility and could require prohibited host SSH
configuration on a hardened host. The design disposition is therefore
`FALLBACK`: run one bounded `mwiede/jsch` comparison before choosing the A3.1
transport dependency.

The comparison had to preserve the same non-exportable Keystore key, explicit
fingerprint review and exact pin, exact non-PTY command, JSONL bounds,
sanitized failures, cleanup, and privacy rules. It had to test RSA plus at
least one modern non-RSA host-key family. If it could not do so without
exportable key material, blind trust, unsafe provider mutation, or another
contract weakening, the result would have returned to design rather than
being adopted.

### A3.0F Result and Production Dependency Disposition

The pushed A3.0F evidence at
`codex/android-jsch-a3-fallback-spike` commits `eb633e8`, `b71754f`, and
`c26be77ef1aab789de3661877271cf318dfb8008` is accepted.

On an Android API 36 emulator and disposable loopback SSH host,
`mwiede/jsch` `2.28.5` passed the full contracted boundary with RSA SHA-2 and
ECDSA P-256 host keys. Ed25519 was attempted and failed before the verifier;
the experiment did not add Bouncy Castle, change providers, weaken host trust,
or change the server. The branch CI run
[`30194178747`](https://github.com/plaonn/codex-radar/actions/runs/30194178747)
passed all jobs.

Disposition: `ACCEPT`. A3.1 adopts `mwiede/jsch` `2.28.5` with the explicit
RSA SHA-2 plus ECDSA P-256 supported-host boundary. Ed25519-only hosts remain
unsupported and fail closed before authentication.

## A3.1 Adoption Gate

The fallback comparison is collected and `mwiede/jsch` `2.28.5` is selected,
so A3.1 is ready for a separately claimed production integration. It may
replace or complement the fixture transport behind the existing A2
protocol/domain/UI boundary.

A3.1 must:

- wire the adopted dependency into the production foreground transport;
- persist immutable profile identity, app-owned Keystore alias, and exact host
  pin without persisting private-key material or raw remote data;
- support the explicit RSA SHA-2 and ECDSA P-256 host-key boundary;
- map an Ed25519-only host to a sanitized unsupported-host-key failure before
  authentication;
- execute exactly `codex-radar mobile rpc` without PTY, interactive shell, or
  user-controlled command interpolation;
- start bounded/discarded stderr draining immediately after exec and before
  protocol initialization;
- preserve the 1 MiB inbound and outbound frame bounds, foreground-only
  lifecycle, fresh reconnect baseline, cleanup, sanitized failures, and
  privacy-negative guarantees;
- add unit, disposable-host integration, and emulator/device tests for
  credential lifecycle, trust, supported/unsupported host keys, framing,
  disconnect/reconnect, process loss, and failure mapping.

A3.1 acceptance requires integration into `main`, applicable local checks, and
successful post-integration CI. A3.1 completion does not start A4; parent
collection must explicitly accept the integration before A4 may be claimed.

### A3.1 Acceptance Result

A3.1 is accepted at integrated commit
`e96c27d97b6b821d05bc5a9bf7e0299aa6dd9ddb`.

The production transport, profile and trust UI, Android Keystore identity,
bounded protocol client, lifecycle handling, disposable-host smoke, privacy
checks, and retained fixture boundary satisfy the adoption gate. RSA SHA-2 and
ECDSA P-256 passed the production boundary; Ed25519-only hosts fail before
authentication with the stable `unsupported_host_key` category. The runtime
dependency graph contains `mwiede/jsch` `2.28.5` without Bouncy Castle or
another transitive runtime dependency, and the required BSD/ISC notices are
retained.

Applicable local checks passed, and post-integration GitHub Actions run
[`30197311626`](https://github.com/plaonn/codex-radar/actions/runs/30197311626)
completed successfully for the exact accepted commit. Public-safe evidence is
recorded in [Android A3.1 production transport evidence](../experiments/android-a3-1-production.md).

Disposition: `ACCEPT`. The separately designed A4 smoke is ready for a fresh
claim. This acceptance does not claim A4, Android signing or publication,
physical-device support, background behavior, Ed25519 support, remote write
authority, or production-host validation.

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
