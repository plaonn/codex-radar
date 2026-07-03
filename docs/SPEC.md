# codex-radar Spec

## Root Goal

`codex-radar` helps an operator see which local Codex conversations belong to which projects, what state they are in, and whether a recent transcript is worth opening.

## Requirements

- Capture Codex lifecycle hook payloads without blocking Codex turns for long.
- Index local sessions by `session_id`, `cwd`, project name, latest event, status, transcript path, model, permission mode, and latest assistant summary when available.
- Provide a terminal-first workflow:
  - `codex-radar hook` records one hook payload from stdin.
  - `codex-radar sessions` lists known sessions.
  - `codex-radar transcript <session-or-path>` skims a local transcript.
  - `codex-radar tui` opens a lightweight session dashboard.
- Avoid modifying global Codex config automatically.
- Avoid committing or uploading local transcript contents or runtime state.

## Rationale

The Codex IDE extension can run multiple conversations across projects, but project/session ownership and completion state are hard to scan from the editor alone. Codex hooks already expose lifecycle payloads, including session and transcript metadata, so a local indexer can solve the visibility problem without depending on private IDE internals.

## Failure Prevented

- Losing track of which Codex conversation belongs to which repository.
- Missing turns that stopped, requested approval, or changed tool state.
- Opening full transcripts just to identify recent context.
- Coupling monitoring to unstable VS Code extension internals.

## Current Architecture

`codex-radar` is a stdlib-first Python CLI.

```text
Codex hook event
  -> codex-radar hook
  -> events.jsonl append-only log
  -> sessions.json derived latest-state cache
  -> sessions/transcript/tui commands
```

Runtime state defaults to:

```text
$CODEX_RADAR_HOME
or $XDG_STATE_HOME/codex-radar
or ~/.local/state/codex-radar
```

The state directory contains:

- `events.jsonl`: append-only normalized hook events.
- `sessions.json`: derived latest session cache.
- `.lock`: coarse file lock used while appending/updating state.

## Data Model

Normalized event fields:

- `recorded_at`: local capture time in UTC ISO-8601.
- `event_name`: hook event name such as `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, or `Stop`.
- `session_id`
- `turn_id`
- `status`: derived status for dashboard use.
- `cwd`
- `project`: basename of `cwd`.
- `transcript_path`
- `model`
- `permission_mode`
- `tool_name`
- `last_assistant_message`
- `raw`: original hook payload.

Derived statuses:

- `active`: session started or resumed.
- `running`: user turn is underway.
- `tool_running`: tool execution started.
- `waiting_approval`: Codex requested permission.
- `done`: turn stopped.
- `unknown`: event did not map cleanly.

## Automation Boundary

Allowed:

- Read one hook payload from stdin.
- Write local state below the configured state directory.
- Read local transcript files when the user runs transcript/TUI commands.

Prohibited:

- Automatically editing `~/.codex/hooks.json`.
- Sending notifications, telemetry, transcripts, or session metadata to external services.
- Deleting Codex transcripts.
- Mutating repositories observed through `cwd`.

## Privacy Boundary

Transcripts and hook payloads may contain private paths, prompts, code, command output, and secrets. `codex-radar` treats them as local sensitive data. Transcript skim output redacts common secret-like tokens on a best-effort basis, but this is not a security boundary.

## Non-goals

- No IDE extension integration in the initial version.
- No cloud sync.
- No live token streaming.
- No replacement for Codex's native transcript viewer.
- No automatic notification delivery until a separate requirement defines channel, content, and privacy rules.
