# codex-radar Tasks

## Now

- None

## Watching

- None

## Later

- `delegate: improve TUI transcript preview`
  - Root goal: make the TUI useful for quick conversation triage without opening full transcripts.
  - Requirement: add selection, detail pane, and transcript preview within the local-only privacy boundary.
  - Rationale: session list alone identifies project/status but not whether a conversation needs attention.
  - Failure prevented: unnecessary full transcript opening and missed follow-up context.
  - Decision authority: delegated decision.
  - Allowed state changes: code, tests, docs, commit allowed.
  - Prohibited state changes: no external notification, no global Codex config mutation, no transcript deletion.
  - Stop condition: pause if preview requires storing extra transcript content in the session cache.
  - Done means: focused tests pass and TUI behavior is documented.

- `proposal: notification boundary`
  - Root goal: define when and how `codex-radar` should notify the operator.
  - Requirement: compare local desktop notification, terminal bell, and no-notification defaults.
  - Rationale: notifications can leak prompt or repository metadata if designed loosely.
  - Failure prevented: accidental exposure of sensitive session context.
  - Decision authority: proposal-only.
  - Allowed state changes: docs only.
  - Prohibited state changes: no implementation, no global config mutation, no external service integration.
  - Stop condition: produce a recommendation and pause for user decision.
  - Done means: `docs/ROADMAP.md` or a decision note captures the selected boundary.
