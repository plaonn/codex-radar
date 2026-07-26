# Android Foreground Cockpit MVP

## Decision

The first Android product phase is a foreground, read-only cockpit over a
user-owned SSH connection. It reuses the host-local Radar display-state and
bounded preview contracts proven by Mobile SSH Read Protocol Stage 0.

The MVP is not a notification service, remote Codex client, daemon, or public
Android distribution commitment.

## Root Outcome

While the app is visible, a user can connect to one selected POSIX host and:

- see Radar threads grouped by project;
- distinguish attention, running, done, archived, and unavailable state;
- open one bounded, redacted transcript preview;
- receive in-app foreground attention for a new approval request or a
  running-to-done transition;
- disconnect and reconnect without treating missed events as replayable.

The host remains the owner of lifecycle truth and transcript access. Android is
a sanitized client, not a second indexer.

## Product Boundary

### Included

- locally stored host profiles with display name, host, port, user, and
  host-key identity;
- one active foreground SSH connection at a time;
- explicit protocol negotiation before state or preview reads;
- project/thread navigation backed by `codex-radar.display-state` v1;
- an explicitly requested bounded preview backed by negotiated
  `codex-radar.transcript-preview` v1 or v2;
- connection-local foreground attention events;
- manual refresh, disconnect, and reconnect;
- sanitized connection and protocol diagnostics.

### Excluded

- background service, persistent wake lock, push, or OS notification;
- replay of events missed while disconnected;
- thread resume, message send, archive, rename, approval, or any remote write;
- multi-host aggregation or simultaneous connections;
- shared read/unread state or cloud sync;
- direct Android access to host transcript, rollout, or state files;
- remote HTTP listener, daemon, proxy, or inbound firewall change;
- password authentication in the initial MVP;
- Play Store, public APK, signing, auto-update, or support-level publication;
- unification with experimental R12 `codex-radar thread rpc`.

## UX Flow

1. **Host profiles**
   - Create or select one profile.
   - Show the pinned host-key identity and key-based authentication status.
   - Never display or log private key material.
2. **Connect**
   - Establish SSH only after explicit user action.
   - Reject an unknown or changed host key until the user reviews the
     fingerprint; a mismatch is a hard failure, not a warning bypass.
   - Launch the packaged read-only Radar command and negotiate protocol
     versions.
3. **Cockpit**
   - Show connection/source health before thread content.
   - Present Attention first, then projects and archived sessions.
   - Keep session identifiers opaque and avoid host filesystem paths.
4. **Thread preview**
   - Fetch only after explicit selection.
   - Enforce the negotiated contract and bounded message limit.
   - Keep preview content in memory for the current foreground session; do not
     persist it in MVP storage.
5. **Foreground attention**
   - Establish a fresh baseline after each connection.
   - Surface new attention as an in-app banner that navigates to the session.
   - Do not imply delivery while the app or SSH connection is inactive.
6. **Reconnect**
   - Start a new process, initialize again, read current state, and establish a
     new baseline.
   - Reconcile current state rather than inventing missed-event replay.

## Technical Boundary

### Host

- Productize the Stage 0 semantics as a packaged, versioned, read-only command
  separate from R12 write orchestration.
- Reuse Python core display-state and transcript-preview builders.
- Keep stdout JSONL-only and diagnostics on stderr as stable, path-free codes.
- Preserve initialize-first negotiation, bounded request sizes, stable errors,
  and explicit shutdown.
- Do not open a listener or modify Codex configuration.

The exact CLI spelling may be selected during the first implementation package,
but it must have one documented stable entrypoint and must not overload
`codex-radar thread rpc`.

### Android

- Keep Android source and dependencies isolated under `apps/android/`.
- Use a native Android application surface; framework, minimum SDK, and SSH
  library versions are implementation decisions constrained by this contract.
- Separate SSH transport, JSONL protocol client, domain model, and UI state so
  protocol fixtures can test the app without a live host.
- Treat `session_id` as an opaque navigation identifier.
- Do not reconstruct status, archive state, or redaction independently when the
  shared contract already supplies those semantics.

### SSH and Credentials

- The Android client owns SSH connection lifetime and host selection.
- Host-key verification is mandatory. First trust requires explicit
  fingerprint review; changed identity fails closed.
- Initial MVP authentication is key-based only.
- Private credentials must be protected by Android platform-backed secure
  storage or an equivalent non-exportable/encrypted boundary selected during
  the SSH implementation package.
- Secrets, private paths, raw requests, and preview content must not enter logs,
  crash reports, fixtures, screenshots, or repository artifacts.
- Any dependency with incompatible licensing, paid infrastructure, or an
  account requirement is a stop condition for design review.

## Failure Model

- Missing host runtime or unsupported protocol: show a stable setup error and
  make no fallback attempt to scan remote files.
- Host-key mismatch: disconnect and require explicit profile repair.
- Authentication failure: report a sanitized category without echoing secrets.
- Malformed or oversized JSONL: fail the connection; do not partially render
  untrusted content.
- Preview unavailable: retain the thread list and show a bounded per-session
  error.
- SSH loss: mark data disconnected, stop attention delivery, and require
  explicit or foreground-controlled reconnect.
- App backgrounded: the MVP may close the session; it must not claim continuous
  monitoring.

## Ordered Implementation Packages

### A1: Packaged Host Read Protocol

- Move the proven Stage 0 semantics into supported Python core/CLI surfaces.
- Preserve the non-packaged spike as test evidence or replace it with fixtures
  that prove equivalent behavior.
- Add schema/golden, bounds, stdout/stderr, privacy, disconnect, and reconnect
  tests.
- Exit: an installed helper exposes one documented read-only command with the
  Stage 0 contract and no R12 write authority.

Current truth: accepted and complete in helper runtime `0.4.12` as
`codex-radar mobile rpc`, with a 1 MiB inbound request-frame bound.
The implementation reuses one Python core with the Stage 0 spike and provides
`tests/fixtures/mobile-rpc-v1.json` for A2; it does not authorize A2.

### A2: Android Fixture Cockpit

- Create `apps/android/` with isolated build configuration.
- Implement protocol/domain/UI layers against deterministic fixtures.
- Cover host profile, connection states, project grouping, attention, bounded
  preview, and reconnect UI without requiring live SSH.
- Exit: repeatable unit/UI tests demonstrate the complete read-only UX using
  fixtures.

Current truth: implemented as a Kotlin native platform-Views app with package
`dev.codexradar.cockpit`, minimum SDK 26, mechanically derived host fixtures,
fixture drift/privacy guards, JVM tests, and API 36.1 emulator UI coverage.
Preview content remains memory-only, foreground attention establishes a fresh
baseline after each connection, and the app has no network permission, SSH
dependency, credential handling, background component, or remote write path.

### A3: Foreground SSH Transport

- Select an SSH dependency using security, license, maintenance, key-format,
  host-key verification, and Android compatibility evidence.
- Implement key-based authentication, explicit host trust, process lifecycle,
  JSONL framing, and sanitized errors.
- Exit: the app connects to a disposable POSIX test host and launches the
  packaged command without server-side network configuration.

### A4: End-to-End MVP Smoke

- Use a real Android device or emulator and one POSIX host with Radar state.
- Verify state, project grouping, bounded preview, foreground attention,
  disconnect, reconnect, host-key mismatch, and authentication failure.
- Inspect logs and persisted app data for prohibited transcript, path, and
  credential residue.
- Exit: evidence satisfies the M4A Roadmap criterion. Android publication
  remains a separate decision.

## Verification Contract

- Python protocol tests and repository-wide Python checks pass.
- Android unit and UI tests pass in the selected build environment.
- Protocol fixtures are shared or mechanically derived so host and Android
  semantics cannot silently drift.
- One disposable SSH integration test covers framing and process cleanup.
- One device/emulator smoke covers the full foreground user flow.
- Privacy-negative tests verify that raw paths, transcripts, keys, and unsafe
  diagnostics are absent from protocol state, logs, and persisted client data.

## Decision Ownership and Automation Boundary

- The user owns Android product activation, signing/publication, support scope,
  background behavior, credential-policy expansion, paid services, and remote
  write authority.
- Codex may make conservative implementation choices inside an adopted package
  when they preserve this read-only boundary and introduce no account, cost, or
  licensing decision.
- Implementation workers may edit repository code/tests/docs, create isolated
  Android dependencies under `apps/android/`, and commit/push only when their
  adopted task explicitly allows it.
- No package may modify `hooks.json`, open a listener, install a daemon, publish
  an Android artifact, or claim Native Windows completion.

## Current Disposition

The MVP design is active. A1 and A2 are integrated. A3.0F was accepted and
selected `mwiede/jsch` 2.28.5 without Bouncy Castle; A3.1 integrates that
foreground transport under the adopted production contract. A4 remains
separately gated on explicit A3.1 acceptance. Background behavior, signing,
publication, remote writes, and credential-policy expansion remain
unauthorized.
