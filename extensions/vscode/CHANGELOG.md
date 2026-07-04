# Changelog

All notable changes for the Codex Radar VS Code extension are tracked here.

## 0.1.7

Release readiness package for local VSIX and GitHub Release validation. This version is not a Marketplace publication.

### Added

- Dedicated Codex Radar Activity Bar container with project-grouped session navigation.
- Extension host-local `sessions.json` reader with automatic refresh on cache creation, update, or deletion.
- Status filtering for `waiting_approval`, `running`, `tool_running`, `done`, and `stale`.
- View badge for total attention-worthy sessions: `waiting_approval`, `stale`, and unread `done`.
- Done-session read/unread state with mail-style row actions.
- Experimental `Open in Codex` handoff using the current official Codex extension URI route.
- Retention configuration and prune actions routed through the configured `codex-radar` CLI.

### Boundary

- No hook installation or `~/.codex/hooks.json` editing.
- No direct `codex resume` execution.
- No raw transcript file or raw transcript path display in the default navigation.
- No external transmission of transcript or session metadata.

### Packaging

- Package command: `npm --prefix extensions/vscode run package`.
- Generated VSIX artifacts are ignored by git and must not be committed.
- GitHub Release attachment is the first planned distribution path; Marketplace publishing remains a separate decision.
