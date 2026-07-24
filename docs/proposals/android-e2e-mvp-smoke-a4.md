# Android End-to-End MVP Smoke A4

## Status and Decision

This design is approved for the Android foreground cockpit lineage. It defines
the final M4A end-to-end evidence package, but it does not claim or authorize
execution while A2 or A3 integration gates remain open.

The required M4A completion authority is a reproducible Android emulator smoke
against a disposable POSIX SSH host. A physical Android-device smoke is
deferred to the separate Android signing or publication gate.

## Root Outcome

Prove that the accepted Android app, foreground SSH transport, packaged
`codex-radar mobile rpc` helper, and host-local sanitized Radar state work as
one bounded system:

- no remote listener, daemon, firewall change, or system SSH configuration;
- no real transcript, private host path, production credential, or personal
  Codex state in test evidence;
- no background-delivery, remote-write, signing, or publication claim;
- deterministic failure and cleanup evidence for trust, authentication,
  framing, disconnect, and reconnect.

## Design Lineage and Dependencies

- Product contract:
  [Android Foreground Cockpit MVP](android-foreground-cockpit-mvp.md)
- Host contract: helper runtime `0.4.12`, stable
  `codex-radar mobile rpc`, read protocol v1, display-state v1, negotiated
  transcript-preview v1/v2, and a 1 MiB host inbound request-frame bound.
- Android fixture predecessor: accepted A2 Kotlin/platform-Views cockpit,
  mechanically derived fixtures, and privacy-negative checks.
- Transport predecessor:
  [Android Foreground SSH Transport A3](android-foreground-ssh-transport-a3.md).
- Execution dependency: A2 must be integrated into `main`; A3.0 must pass and
  be accepted; A3.1 production foreground transport must then be integrated
  with successful post-integration checks.
- Dependency mode: `wait-for-completion`. Only read-only A4 design work may run
  before those gates close.

## Completion Authority

The M4A exit criterion requires:

1. one repeatable Android emulator run;
2. one disposable POSIX SSH host on the development machine;
3. the installed packaged helper, not a fixture transport or direct Python
   module call;
4. the production A3 foreground SSH boundary;
5. all required success, failure, reconnect, and privacy scenarios;
6. a public-safe result manifest tied to exact source and tool versions.

A physical device is not required to complete M4A because Android publication
and public device-support commitments remain out of scope. It becomes a
mandatory separate gate before an APK/AAB or store publication is approved.

Paid device farms, Firebase Test Lab, and hosted SSH infrastructure are not
required. Gradle-managed-device automation may be considered later only after
the local emulator smoke is stable and its lifecycle cost is justified.

## Disposable Topology

```text
Android emulator
  -> 10.0.2.2:<ephemeral-high-port>
  -> host loopback
  -> disposable user-mode sshd
  -> exact non-PTY command: codex-radar mobile rpc
  -> temporary CODEX_RADAR_HOME and CODEX_HOME
  -> synthetic sessions.json and synthetic transcript
```

- Bind the disposable SSH server to host loopback on an ephemeral high port.
- Use the Android emulator host-loopback alias `10.0.2.2`.
- Generate temporary server host keys and `authorized_keys` inside one
  disposable directory.
- Use an isolated `sshd_config` for the harness only.
- Set the command environment to temporary `CODEX_RADAR_HOME`, `CODEX_HOME`,
  and a PATH containing the installed candidate helper.
- The Android client must still request exactly
  `codex-radar mobile rpc`; no PTY, interactive shell, user-controlled command,
  wrapper command, or protocol-specific CLI argument is allowed.
- Shut down the temporary SSH process and remove its directory after the run,
  including on failure.

The harness must not enable system Remote Login, edit global SSH files, open a
public interface, change a firewall, create an OS user, or require elevated
privileges. If a safe user-mode SSH server cannot be started, stop and report
the environment blocker instead of weakening the topology.

## Synthetic Host Truth

- Generate a temporary `sessions.json` that includes:
  - at least two projects;
  - one attention-required session;
  - running and done sessions;
  - one archived session;
  - opaque session identifiers.
- Generate only synthetic rollout/transcript records needed for a bounded
  preview.
- Reuse or mechanically derive the canonical display-state and preview
  fixtures where practical.
- Drive attention transitions by changing the synthetic host state through a
  deterministic harness step, not by inserting Android-only UI events.
- Preserve the host as the owner of display status, archive state, attention,
  redaction, and preview semantics.
- Never point the smoke at the operator's default Radar state or Codex home.

## Required Scenario Sequence

### 1. First Trust and Authentication

- Connect to the disposable endpoint with no existing pin.
- Confirm that the app stops before authentication and shows host, port,
  algorithm, and SHA-256 fingerprint.
- Approve the synthetic fingerprint explicitly.
- Authenticate using the app-generated, non-exportable Android Keystore key.
- Confirm exact host-key pin persistence for the test profile.

### 2. Foreground RPC and State

- Launch one non-PTY command channel with exactly
  `codex-radar mobile rpc`.
- Complete initialize-first protocol negotiation.
- Read current state and verify Attention-first ordering, project grouping,
  archived separation, opaque navigation, and source/connection health.

### 3. Bounded Preview

- Select a synthetic session explicitly.
- Read and render the negotiated bounded preview.
- Confirm that no raw host path, transcript path, request payload, or
  unredacted canary reaches UI state.
- Confirm that preview content remains memory-only.

### 4. Foreground Attention

- Perform the first `attention/poll` and verify that it establishes a baseline
  without replaying historical attention.
- Mutate synthetic host state to a new `waiting_approval` transition and verify
  an in-app banner plus navigation to the exact opaque session.
- Mutate a `running` or `tool_running` session to `done` and verify the same
  foreground-only event boundary.

### 5. Background, Disconnect, and Reconnect

- Move the app out of the foreground and verify that the command channel and
  SSH connection close.
- Verify that attention delivery stops and no background component remains.
- Return to foreground, reconnect with the pinned identity, start a new RPC
  process, initialize, read current state, and establish a fresh baseline.
- Confirm that missed events are not replayed and current state is reconciled.

### 6. Host-Key Mismatch

- Stop the disposable server and restart the same endpoint with a different
  host key.
- Verify a hard mismatch failure before authentication or command execution.
- Confirm that the existing pin is not replaced automatically and no warning
  bypass is offered.

### 7. Authentication Failure

- Use an endpoint configuration that rejects the app public key.
- Verify a sanitized authentication category without public-key material,
  username echo in logs, remote diagnostics, or automatic password fallback.

### 8. Protocol and Frame Failure

- Return malformed and oversized JSONL frames from a controlled disposable
  endpoint.
- Verify the Android 1 MiB inbound-frame bound is applied before unbounded
  buffering or parsing.
- Fail the connection without partially applying new UI state.
- Verify that reconnect starts from a clean protocol state.

## Privacy-Negative Evidence

Use synthetic canaries for:

- a private host path;
- a credential-like value;
- raw request content;
- unredacted transcript content;
- remote stderr detail;
- private-key marker.

The harness must inspect:

- Android application logs;
- debug app private files, shared preferences, and databases;
- screenshots or screen recordings retained as evidence;
- the public-safe result manifest;
- temporary host-side evidence selected for retention.

The intentionally displayed synthetic bounded preview is allowed only while
the connected foreground screen is active. After disconnect and process
recreation, its canary must not appear in persisted Android storage.

Do not retain private keys, full temporary paths, raw JSONL exchanges, raw
stderr, or generated app data as repository artifacts.

## Evidence Manifest

Produce one deterministic, public-safe result summary containing:

- repository commit;
- helper and Android app versions;
- Android API and emulator version;
- SSH client dependency/version;
- OpenSSH server version;
- scenario identifiers and pass/fail result;
- privacy scan result;
- cleanup result;
- timestamp and operating-system family.

Exclude usernames, home paths, IP addresses other than the documented emulator
alias, ephemeral port values, fingerprints, keys, transcript text, raw protocol
frames, and remote stderr.

Screenshots are optional supporting evidence, not completion authority. If
retained, they must contain only synthetic content and pass the same canary
scan.

## Verification and Done

A4 is complete only when:

- all required scenarios pass on the accepted A3.1 production transport;
- the emulator connects through disposable SSH to the installed packaged
  helper and exact RPC command;
- Android unit/UI/instrumentation checks pass;
- repository Python tests and compileall pass;
- applicable CI for the integrated source commit succeeds;
- privacy-negative and cleanup checks pass;
- no system/global SSH configuration or unrelated project state changed;
- evidence is tied to one exact integrated commit;
- the result is collected and explicitly accepted as satisfying the M4A exit
  criterion.

A passing A4 smoke does not authorize Android signing, APK/AAB/store
publication, background notifications, physical-device support claims, remote
writes, Native Windows completion, or a new public release.

## Authority and Stop Conditions

Once all dependencies are satisfied, Codex may implement and run this
account-free disposable smoke, create synthetic fixtures and harness code,
update test/evidence documentation, and commit/push the bounded A4 package.

Stop and return to design if:

- A2 or A3.1 is not integrated and accepted;
- execution requires a real credential, personal Radar/Codex state, production
  host, system SSH configuration, elevated privilege, paid service, or account;
- exact `codex-radar mobile rpc` execution cannot be preserved;
- emulator networking cannot reach a loopback-only disposable SSH process
  without opening a broader interface;
- privacy inspection cannot distinguish allowed in-memory synthetic preview
  from prohibited persisted residue;
- a new product, signing/publication, support, background, credential, or
  remote-write decision is required.

## Reference Evidence

- [Android Emulator network address space](https://developer.android.com/studio/run/emulator-networking-address)
- [Android build-managed devices](https://developer.android.com/studio/test/managed-devices)
- [Android hardware-device testing](https://developer.android.com/studio/run/device)
