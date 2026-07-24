# Changelog

All notable changes for the Codex Radar VS Code extension are tracked here.

## 0.4.19

### Changed

- Consolidate the post-`0.4.12` extension work into the next public-beta candidate.
- Align packaged installation guidance with the published `v0.4.12` baseline while preserving the current source behavior.

### Boundaries

- Keep GitHub Release publication separate from candidate preparation and validation.
- Do not publish to the VS Code Marketplace or claim Native Windows support complete before the real hook-to-sidebar smoke.

## 0.4.18

### Changed

- Open Sidebar transcript Preview from the selected in-memory session before refreshing shared session state and the Codex thread catalog.
- Refresh the Preview after background synchronization only when the originating Sidebar interaction is still current.

### Boundaries

- Preserve the existing 220 ms single-click/double-click disambiguation and double-click **Open in Codex** behavior.
- Keep dashboard selection, direct/observe/export adapters, export-to-direct fallback, privacy boundaries, and Remote SSH execution unchanged.

## 0.4.17

### Fixed

- Preserve missing, empty, and stale host-local session-index setup diagnostics when the default shared export source succeeds or falls back.
- Keep filesystem error details path-free and route ambiguous missing/empty/stale states through the read-only `codex-radar-helper diagnose` check before attributing them to hook wiring.

### Boundaries

- Do not install the helper, edit Codex hook configuration, rewrite Radar state, or infer a hook defect from the absence of indexed sessions.

## 0.4.16

### Fixed

- Classify Sidebar `Current Workspace` groups from raw session `cwd` evidence before sanitized card conversion removes private path fields.
- Preserve the project-basename fallback only for legacy sessions that genuinely have no `cwd`.

### Boundaries

- Keep official `Open in Codex` workspace mismatch behavior unchanged.

## 0.4.15

### Added

- Add a distinct **Open in Codex CLI** action to Radar sidebar, dashboard, and Preview sessions.
- Resume the exact selected session in a user-visible VS Code integrated terminal using the configured Codex executable and the available raw session working directory.

### Boundaries

- Pass `resume` and the session id as structured terminal argv instead of composing a shell command string.
- Fall back to the integrated terminal's default working directory when Radar has no session `cwd`.
- Keep the existing official **Open in Codex** URI and workspace-mismatch behavior unchanged; do not infer client/status, auto-fork, or run in the background.

## 0.4.14

### Added

- Show locale-aware recorded times and local-calendar date separators in the transcript Preview when valid rollout timestamps are available.
- Negotiate transcript-preview v2 explicitly while retaining the immutable v1 contract for existing clients.

### Boundaries

- Read message time only from a timezone-aware top-level rollout timestamp; do not infer it from nested payload fields, file metadata, or session cache time.
- Omit time/date UI when the source timestamp is missing or malformed.
- Keep direct, observe, and export preview adapters aligned, including adjacent duplicate timestamp merging.

## 0.4.13

### Changed

- Use the Python shared sanitized display-state export as the default VS Code list source after the public `0.4.4` observation release and current installed-host parity smoke.
- Fall back to the direct host-local session adapter when the export command is unavailable, fails, or returns an invalid/unsupported contract.

### Boundaries

- Keep raw working directory and transcript metadata in the trusted extension-host adapter only for workspace handoff, explicit preview, and fallback behavior.
- Retain explicit `observe` and `direct` modes for diagnosis and compatibility.
- Keep the direct session reader while fallback and trusted action metadata still require it; no Node-side scanner is removed without a replacement for those host-local responsibilities.

## 0.4.12

### Changed

- Classify sessions under the host-local Codex memory-maintenance root as `Codex internal` instead of presenting `memories` as an ordinary repository project.
- Apply the classification while reading existing session caches, without rewriting or hiding the underlying session records.

### Boundaries

- Keep ordinary repository working directories grouped by their existing project names.
- Do not generalize the rule to every hidden directory or every path under `CODEX_HOME`.

## 0.4.11

### Changed

- Package the current app-server usage adapter, reusable controller, and source documentation as the next GitHub Release candidate.
- Keep shared display-state export in observation mode until a current installed helper and VSIX provide live extension-host parity evidence.
- Document the Native Windows foundation without claiming support completion before the real hook-to-sidebar smoke.

### Boundaries

- Keep GitHub Release publication separate from candidate preparation and validation.
- Do not publish to the VS Code Marketplace or treat Windows CI as a substitute for the real-host smoke.

## 0.4.9

### Changed

- Read Codex usage from the supported app-server `account/rateLimits/read` method through the reusable controller.
- Normalize app-server `usedPercent`, `windowDurationMins`, and `resetsAt` into the existing semantic 5-hour/7-day remaining-usage model.
- Fail closed on malformed usage windows and ignore nullable duration/reset fields instead of normalizing them as zero.
- Keep the rollout adapter as a one-release fallback and local parity observation source.

### Boundaries

- Keep `sessions.json` as the lifecycle attention source; app-server usage support does not change the hook/helper requirement.
- Coalesce usage refreshes so rollout file changes do not create overlapping app-server requests.

## 0.4.7

### Added

- Add a Codex App Server Controller that lazily starts and reuses a separately installed `codex app-server` process for read-only thread catalog requests.
- Add an optional `codexRadar.codexExecutable` setting for extension-host installations where `codex` is not on `PATH`.

### Boundaries

- Do not bundle a Codex binary or depend on the official Codex extension's private runtime path.
- Keep app-server access limited to `thread/list`; the Python hook/helper remains the lifecycle state producer until parity and real-host migration smoke are complete.

## 0.4.6

### Added

- Document the native Windows state-directory default used by the shared Python runtime.
- Package the extension alongside the native Windows helper foundation and `windows-latest` validation.

### Boundaries

- Native Windows Codex hook smoke remains required before Windows support is declared complete.
- WSL2 remains outside the official validation scope for this milestone.

## 0.4.5

### Fixed

- Keep sidebar row identity stable across session activity refreshes so delayed selection, Open in Codex, and Copy Session ID interactions continue to target the session the user acted on.
- Ignore an older delayed click after a newer sidebar interaction, cancel pending selection when opening a row context menu, and close stale context menus when new state arrives.

### Boundaries

- Keep timestamp-bearing state keys for read/unread version tracking while using the exact session id as the interaction identity.
- Preserve the existing 220 ms single-click delay used to distinguish sidebar selection from double-click Open in Codex.

## 0.4.4

### Added

- Add a shared-export read adapter for `codex-radar export state --json` and explicit bounded transcript preview export.
- Add local observation mode that compares export and direct session semantics while keeping the direct adapter effective.

### Boundaries

- Keep the direct host-local adapter as the fallback for export command failure, source unavailability, and schema mismatch during this migration release.
- Keep raw `cwd` and transcript paths out of the sanitized export contract and use direct metadata only inside the trusted extension host for workspace handoff and local preview fallback.
- Keep read/unread state extension-local; this public beta remains a GitHub Release artifact rather than a Marketplace publication.

## 0.4.3

### Changed

- Make cross-workspace Codex handoff an explicit two-step flow. Radar opens the destination project in a new VS Code window, then the user opens the thread from Radar in that window.

### Boundaries

- Remove the extension-global pending handoff and focus-triggered URI retry because the Codex URI does not provide a supported way to target a specific VS Code window.
- Keep direct Codex thread opening unchanged when the session already belongs to the current workspace or the user explicitly selects `Open Here`.

## 0.4.2

### Fixed

- Identify the 5-hour and 7-day Codex usage pools by `window_minutes` instead of assuming that `primary` and `secondary` always have fixed meanings. A missing pool now stays in its `--` slot while the remaining pool is shown in the correct position.
- Delay cross-workspace Codex thread URI handoff until the destination workspace window is focused, preventing the previously active Radar window from receiving the selected thread.

### Boundaries

- Preserve `primary` and `secondary` in the experimental rollout adapter output; semantic pool placement is a display/formatting rule with a legacy fallback for events without `window_minutes`.
- Continue using the experimental Codex extension URI because no window-targeted public thread command is exposed.

## 0.4.1

### Added

- Refresh the Radar navigation when archived transcript files are created or deleted on the extension host, so Codex archive and unarchive actions appear without periodic polling.

### Boundaries

- Keep active transcript changes disconnected from Radar navigation refresh and retain the manual Refresh command as the fallback for missed filesystem events.

## 0.4.0

Public beta distributed as a GitHub Release VSIX. This version is not a Marketplace publication and requires the host-local `codex-radar` helper/indexer plus explicit Codex hook setup.

### Added

- Organize Codex threads by project across dedicated `Attention`, `Projects`, and `Archived` sidebar sections and an editor dashboard.
- Preview bounded, redacted recent conversation context and distinguish running, approval, unread done, read done, unknown, and archived states.
- Resume eligible threads through the official Codex extension with workspace-aware handoff for local and Remote SSH windows.
- Diagnose missing, empty, stale, or unsupported host-local session indexes without silently changing hook configuration.
- Surface host-local Codex usage and reset details from the experimental read-only rollout adapter.

### Boundaries

- Keep transcript and session metadata local to the extension host; do not send external notifications or expose raw paths in primary navigation.
- Do not install hooks, edit `~/.codex/hooks.json`, or operate without the host-local Radar state producer.

## 0.3.29

Release candidate package refining the full-color product icon hierarchy. This version is not a Marketplace publication.

### Changed

- Reduce the visual weight of the full-icon-only inner ring, crosshair, sweep field, and sweep line so the outer ring, prompt, and signal dot remain primary.

## 0.3.28

Release candidate package for Codex Radar product branding. This version is not a Marketplace publication.

### Added

- Add coordinated full-color product, reduced color mark, and monochrome Activity Bar icon assets.
- Add a 256px package icon for extension details and future Marketplace presentation.

### Changed

- Replace the generic target glyph with the approved radar-and-prompt identity.
- Align package and README copy around project-grouped Codex threads, attention, and workspace-aware resume.

## 0.3.27

Release candidate package for workspace-aware Codex handoff. This version is not a Marketplace publication.

### Added

- Detect when a session working directory is outside the current VS Code workspace before opening it in Codex.
- Let users ask each time, open the project in a new window, or resume in the current window through `codexRadar.openThreadBehavior`.
- Carry a bounded one-shot handoff into the destination local or Remote SSH window before opening the selected Codex thread.

## 0.3.26

Release candidate package for first-run setup diagnostics. This version is not a Marketplace publication.

### Added

- Diagnose missing state directories, missing or empty `sessions.json`, unsupported session-index schema, and stale session-index activity in the VS Code surface.
- Show setup guidance in the Projects dashboard/sidebar empty state without editing Codex hook configuration.

## 0.3.25

Release candidate package for macro state duration display. This version is not a Marketplace publication.

### Changed

- Show running rows with macro-state duration such as `7m running` instead of treating tool-level events as the user-facing state.
- Preserve running duration across `tool_running` transitions while still showing the current tool as secondary metadata.

## 0.3.24

Release candidate package for stable sidebar project ordering. This version is not a Marketplace publication.

### Changed

- Keep non-attention sidebar projects in a stable name order so running activity does not continuously reshuffle the list.
- Continue to pin current workspace projects first and sort projects needing review by latest attention activity.

## 0.3.23

Release candidate package for sidebar double-click behavior. This version is not a Marketplace publication.

### Fixed

- Prevent sidebar double-click Open in Codex from also opening the Radar preview.

## 0.3.22

Release candidate package for sidebar project navigation and unresolvable done-session cleanup. This version is not a Marketplace publication.

### Changed

- Pin the current VS Code workspace project at the top of the sidebar Projects section.
- Tighten project header styling, chevrons, collapsed spacing, and session indentation.
- Hide done sessions from active navigation when their transcript cannot be resolved.

## 0.3.21

Release candidate package for remaining dashboard usability tasks. This version is not a Marketplace publication.

### Added

- Add a Radar-native status bar item for attention, running, and visible session counts.
- Open eligible sessions in Codex by double-clicking sidebar rows.
- Add an `Open in Codex` action to the preview header.

### Changed

- Tighten sidebar project hierarchy spacing for more native project grouping.
- Constrain preview transcript bubble width and wrapping so long content cannot overflow the editor viewport.

## 0.3.20

Release candidate package for app-server-backed thread titles. This version is not a Marketplace publication.

### Added

- Use host-local `codex app-server thread/list` as an optional read-only catalog for exact session title and archived-session enrichment.
- Preserve Radar lifecycle status and attention counts instead of using app-server loading statuses such as `notLoaded`.

## 0.3.19

Release candidate package for local reset-time usage details. This version is not a Marketplace publication.

### Changed

- Show reset times in extension-host local time.
- Include compact reset countdowns in usage hover and click detail text.

## 0.3.18

Release candidate package for compact usage detail text. This version is not a Marketplace publication.

### Changed

- Compress usage detail text to 5h remaining, 7d remaining, reset time, and plan.
- Use UTC ISO-like reset timestamps instead of locale-dependent strings.

## 0.3.17

Release candidate package for click-to-read usage detail. This version is not a Marketplace publication.

### Changed

- Open the same usage detail text shown in the status bar hover when the status item is clicked.

## 0.3.16

Release candidate package for compact remaining-usage status. This version is not a Marketplace publication.

### Changed

- Show Codex usage in the status bar as remaining 5h and 7d percentages.
- Open a usage detail picker from the status bar item.

## 0.3.15

Release candidate package for host-local Codex usage visibility. This version is not a Marketplace publication.

### Added

- Add a status bar item backed by host-local Codex rollout usage snapshots.
- Add an experimental `codex-radar usage --json` command for read-only usage snapshots.

## 0.3.14

Release candidate package for a larger transcript preview window. This version is not a Marketplace publication.

### Changed

- Increase the default editor preview transcript window from 30 to 120 user/Codex messages.
- Document lazy loading or older-message loading as the next transcript preview UX step.

## 0.3.13

Release candidate package for stable sidebar selection ownership. This version is not a Marketplace publication.

### Fixed

- Keep sidebar and dashboard selection on the same Codex session id when session-cache refreshes change the row key timestamp.
- Prevent selected row focus from falling back to a different attention item while the selected thread is still present.

## 0.3.12

Release candidate package for stable preview session ownership. This version is not a Marketplace publication.

### Fixed

- Keep an open preview bound to the explicitly opened Codex session id during session-cache refreshes.
- Prevent dashboard/sidebar selection fallback from switching the preview tab to a different thread.
- Preserve the clicked sidebar session target across refresh so row key churn does not open the wrong preview.

## 0.3.11

Release candidate package for a persistent preview Webview renderer. This version is not a Marketplace publication.

### Fixed

- Stop replacing the preview Webview HTML on transcript updates.
- Render preview updates through a persistent `preview.js` Webview app so scroll state is based on the current DOM before each update.
- Match messenger behavior: only new preview sessions force bottom scroll; same-session updates follow bottom only if the user was already near the bottom.

## 0.3.10

Release candidate package for host-backed preview scroll restoration. This version is not a Marketplace publication.

### Fixed

- Report preview body scroll position from the Webview back to the extension host.
- Restore same-session preview updates from the extension-host scroll state so transcript refreshes do not jump to the top or bottom unexpectedly.

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
