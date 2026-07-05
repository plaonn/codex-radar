# Changelog

All notable changes for the Codex Radar VS Code extension are tracked here.

## 0.1.11

Release candidate package for Hidden row icon polish. This version is not a Marketplace publication.

### Fixed

- Show hidden session rows with an `eye-closed` icon instead of done mail/read icons.

## 0.1.10

Release candidate package for section-based TreeView navigation and local hide/restore controls. This version is not a Marketplace publication.

### Added

- Split the Codex Radar Activity Bar container into native `Attention`, `Projects`, and collapsed `Hidden` sections.
- Add `Hide from Radar` and `Restore to Radar` row actions backed by extension-local hidden state.
- Exclude hidden sessions from `Attention` and `Projects` while keeping them restorable from `Hidden`.

## 0.1.9

Release candidate package for native TreeView navigation cleanup. This version is not a Marketplace publication.

### Added

- Add an `Attention` root group for `waiting_approval`, `stale`, and unread `done` sessions.
- Keep project groups below the attention inbox so project navigation remains available.
- Add an `attention` view filter for attention-worthy sessions.
- Show project names in session row descriptions inside the `Attention` group.

## 0.1.8

Release candidate package for retention settings fixes after VSIX smoke feedback. This version is not a Marketplace publication.

### Fixed

- Resolve the default `codex-radar` command through the remote user's login shell when the VS Code extension host process PATH returns `ENOENT`.
- Keep explicit `codexRadar.cliPath` as the first-priority override.
- Keep source checkout fallback through `python3 -m codex_radar.cli` for local VSIX validation.

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
