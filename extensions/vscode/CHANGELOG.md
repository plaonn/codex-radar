# Changelog

All notable changes for the Codex Radar VS Code extension are tracked here.

## 0.3.9

Release candidate package for preview scroll-state restoration. This version is not a Marketplace publication.

### Fixed

- Use the stable Codex session id rather than the display row key to decide whether a preview is showing the same session.
- Persist preview body scroll state inside the Webview and restore it across transcript refreshes.
- Keep the preview at the latest message only when opening a new session or when the user was already near the bottom before refresh.

## 0.3.8

Release candidate package for preview scroll behavior correction. This version is not a Marketplace publication.

### Fixed

- Enable preview Webview scripts so the initial scroll-to-latest behavior can run.
- Only auto-scroll a preview when opening a new session; refreshes for the same selected session preserve the user's current scroll position.

## 0.3.7

Release candidate package for messenger-style preview scrolling. This version is not a Marketplace publication.

### Changed

- Restructure the preview tab into a fixed header and a transcript-only scroll body.
- Move session metadata into the preview header so transcript messages remain the primary body content.
- Scroll the transcript body to the latest message when the preview first opens.

## 0.3.6

Release candidate package for balanced VS Code-style sidebar and preview gutters. This version is not a Marketplace publication.

### Changed

- Replace zero-gutter sidebar spacing with compact 4/6/8px spacing aligned to VS Code-style list density.
- Keep project grouping visible with a shallow project-session indent while restoring enough row padding for scanability.
- Keep preview content left-aligned, but restore a moderate 16px editor gutter instead of the over-tight 8px layout.

## 0.3.5

Release candidate package for stronger sidebar and preview layout correction. This version is not a Marketplace publication.

### Changed

- Remove sidebar card-style row chrome so narrow sidebar lists use the full available width.
- Make project grouping clearer with compact project headers and a shallow session indent/rail under each project.
- Left-align preview content in the editor tab, reduce preview gutters further, and remove the duplicate cached summary block above transcript messages.

## 0.3.4

Release candidate package for sidebar and preview visual spacing cleanup. This version is not a Marketplace publication.

### Changed

- Tighten sidebar Webview gutters and session row padding so the list matches narrow VS Code sidebar density.
- Strengthen project grouping in the sidebar with native-feeling separators, a subtle group rail, and indented session rows.
- Reduce preview editor gutters while keeping transcript content on a readable centered measure.

## 0.3.3

Release candidate package for Codex thread-state archived detection. This version is not a Marketplace publication.

### Fixed

- Treat transcript-less side sessions as archived when their `cwd` and `last_seen_at` fall inside an archived Codex thread recorded in host-local `state_5.sqlite`.
- Keep transcript-store archived detection as the primary path, with Codex thread state as a fallback for hook/session id mismatches.

## 0.3.2

Release candidate package for sidebar list cleanup, session context menu, and project folding. This version is not a Marketplace publication.

### Changed

- Remove duplicate section-name headers from sidebar Webview bodies; section names and count badges live in the native VS Code section headers.
- Add a session item context menu that copies the session id instead of showing default edit actions.
- Make sidebar project headers more prominent and foldable, with quiet projects collapsed by default when no status filter is active.

## 0.3.1

Release candidate package for sidebar Projects filter cleanup. This version is not a Marketplace publication.

### Changed

- Remove the inline status dropdown from the sidebar `Projects` Webview body; the native section title filter button remains the sidebar filter entrypoint.
- Keep the editor dashboard topbar status dropdown for the wide dashboard surface.

## 0.3.0

Release candidate package for archived section routing and read-done row dimming. This version is not a Marketplace publication.

### Changed

- Replace the sidebar `Hidden` section with `Archived`, backed by host-local Codex archived transcript resolution.
- Exclude archived sessions from `Attention` and `Projects`, and disable `Open in Codex` for archived sessions.
- Remove VS Code GUI stale freshness filtering/styling; `running` and `tool_running` remain neutral spinner states.
- Apply the muted row treatment to read `done` sessions instead of stale sessions.

## 0.2.9

Release candidate package for archived transcript preview and duplicate message cleanup. This version is not a Marketplace publication.

### Fixed

- Resolve cached transcript paths that have moved from `~/.codex/sessions` to `~/.codex/archived_sessions` by matching the transcript file name.
- Remove adjacent duplicate user/Codex preview messages caused by Codex storing the same surfaced message in both `response_item` and `event_msg` entries.

## 0.2.8

Release candidate package for Codex transcript wrapper parsing. This version is not a Marketplace publication.

### Fixed

- Parse Codex JSONL `payload` wrappers for `response_item` and `event_msg` entries so preview can show real user/Codex messages instead of falling back to cached summaries.

## 0.2.7

Release candidate package for transcript preview fallback. This version is not a Marketplace publication.

### Fixed

- Fall back to the host-local Codex transcript store by session id when a Radar session cache item has no `transcript_path`.
- Show the cached latest Codex summary when no transcript file can be found.

## 0.2.6

Release candidate package for preview conversation cleanup. This version is not a Marketplace publication.

### Changed

- Filter the preview transcript to user and Codex messages instead of broad internal transcript text.
- Render preview messages as chat bubbles with safe Markdown support.

## 0.2.5

Release candidate package for sidebar item preview. This version is not a Marketplace publication.

### Added

- Open a `Codex Radar Preview` editor tab when a sidebar session item is selected.
- Show session metadata and a redacted transcript skim in the preview when the transcript file is available on the extension host.

## 0.2.4

Release candidate package for a sidebar status indicator CSS fix. This version is not a Marketplace publication.

### Fixed

- Scope done and waiting-approval status colors to the dot indicator so session cards do not get a full blue/yellow background from row-level status classes.

## 0.2.3

Release candidate package for sidebar/dashboard status visual cleanup. This version is not a Marketplace publication.

### Changed

- Remove dashboard shortcut buttons from sidebar Webview bodies and sidebar view titles; `Codex Radar: Open Dashboard` remains available through the Command Palette.
- Stop opening the dashboard when a sidebar session card is selected.
- Show `running` and `tool_running` with neutral loading spinners.
- Show unread `done` with a blue/cyan filled indicator and read `done` with a hollow gray indicator.
- Show `unknown` with a colored `!` indicator.
- Treat stale as a freshness modifier on cards instead of replacing the lifecycle indicator.

## 0.2.2

Release candidate package for sectioned sidebar Webviews plus the editor dashboard. This version is not a Marketplace publication.

### Changed

- Replace the restored TreeView sidebar implementation with native collapsible sidebar sections whose bodies are Webview-rendered.
- Keep `Attention`, `Projects`, and collapsed `Hidden` as VS Code sections while moving each section's cards and actions into the Webview message boundary.
- Keep `Codex Radar: Open Dashboard` as the wide editor-tab dashboard using the same sanitized model and actions.

### Boundary

- Keep row/session actions out of VS Code command contributions; Webview messages handle open, read/unread, hide, and restore without touching `sessions.json` or transcripts.

## 0.2.1

Release candidate package for the hybrid sidebar and editor dashboard surface. This version is not a Marketplace publication.

### Changed

- Restore native sidebar `Attention`, `Projects`, and collapsed `Hidden` sections for narrow ambient monitoring.
- Move the Webview dashboard to an editor tab opened by `Codex Radar: Open Dashboard`.
- Keep read/unread, hide/restore, status filter, cache refresh, and experimental Codex handoff state synchronized across sidebar and dashboard surfaces.

### Boundary

- Continue to keep retention/prune controls, transcript preview, direct `codex resume`, hook installation, and external transmission outside the VS Code surface.

## 0.2.0

Release candidate package for the Webview dashboard surface. This version is not a Marketplace publication.

### Changed

- Replace the native TreeView sections with one Webview dashboard in the Codex Radar Activity Bar container.
- Move attention inbox, project grouping, hidden-session restore, status filtering, and selected-session actions into the dashboard surface.
- Keep only the global refresh command as a VS Code command; row/session actions now use the Webview message boundary.

### Boundary

- Continue to avoid hook installation, direct `codex resume`, raw transcript display, retention/prune controls, and external transmission of transcript or session metadata.

## 0.1.15

Release candidate package for row action command palette cleanup. This version is not a Marketplace publication.

### Fixed

- Hide row-target actions from the Command Palette so only global view actions appear there.

## 0.1.14

Release candidate package for leftover retention/prune cleanup. This version is not a Marketplace publication.

### Fixed

- Remove leftover retention/prune command registrations, CLI settings, implementation files, and smoke-test copy from the VS Code extension surface.

## 0.1.13

Release candidate package for Command Palette cleanup. This version is not a Marketplace publication.

### Fixed

- Remove retention and prune commands from the Command Palette while those controls have no clear VS Code surface.

## 0.1.12

Release candidate package for retention command CLI resolution. This version is not a Marketplace publication.

### Fixed

- Treat `codexRadar.cliPath` as an override, with an empty default that uses source checkout or remote login shell resolution.
- Resolve an explicitly configured `codex-radar` command through the login shell before reporting `spawn codex-radar ENOENT`.
- Keep global retention and prune commands out of the Projects title actions so they are not mistaken for project-level controls.

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
