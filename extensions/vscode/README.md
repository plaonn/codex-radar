<p align="center">
  <img src="https://raw.githubusercontent.com/plaonn/codex-radar/main/extensions/vscode/media/codex-radar.png" width="112" alt="Codex Radar icon">
</p>

<h1 align="center">Codex Radar</h1>

<p align="center">
  <strong>Your Codex threads, organized by project.</strong><br>
  See what is running, what needs attention, and resume in the right workspace.
</p>

Version `0.4.4` is the current Codex Radar public beta, distributed through GitHub Releases and not published to the VS Code Marketplace.

The current source package version is `0.4.11`. It uses the read-only Codex App Server Controller for supported rate-limit usage reads while keeping the rollout adapter as a one-release fallback and parity observation source. Native Windows support is not complete until a real Codex hook-to-sidebar smoke succeeds. WSL2 is outside this milestone's official validation scope.

## Current Scope

- Provides a dedicated Codex Radar Activity Bar container.
- Keeps the direct `sessions.json` adapter effective by default while locally observing semantic parity with `codex-radar export state --json`. Set `codexRadar.readSource` to `export` to opt into the shared sanitized contract; export failure or schema mismatch falls back to the direct adapter for this migration release.
- Shows setup diagnostics when the extension host cannot find or use the Radar state directory/session index, including missing state, missing or empty `sessions.json`, unsupported schema, and stale index activity.
- Refreshes automatically when `sessions.json` is created, changed, or deleted, and when an archived transcript is created or deleted under the extension host's `CODEX_HOME` (or `~/.codex`). Active transcript changes do not refresh the navigation, and the manual refresh command is the fallback instead of periodic polling.
- Provides native collapsible sidebar sections for `Attention`, `Projects`, and collapsed `Archived`, with each section body rendered by a Webview.
- Provides `Codex Radar: Open Dashboard` to open a richer Webview dashboard in an editor tab.
- Shows `waiting_approval` and unread `done` sessions in the sidebar and dashboard attention inbox.
- Keeps project-grouped navigation in the sidebar `Projects` section and dashboard project list.
- Routes host-local Codex archived sessions to the sidebar `Archived` section and dashboard archived list.
- Also uses Codex local thread state as a direct archived-thread fallback when the Codex thread id matches the Radar session id.
- Opens a single-session editor preview when a sidebar session item is selected. In export mode this explicit action invokes `codex-radar export preview <session-id> --limit 120`; direct transcript preview remains the fallback. The preview shows bounded redacted user/Codex messages with safe Markdown rendering.
- Separates lifecycle status, done read state, and archived state in sidebar/dashboard cards.
- Shows `running` and `tool_running` with neutral loading spinners.
- Shows unread `done` with a blue/cyan filled indicator and read `done` with a hollow gray indicator plus muted row treatment.
- Shows `unknown` with a colored `!` indicator.
- Prefixes rows/cards with a short session id when no readable thread title is available in `sessions.json`.
- Shows the total unfiltered attention count in the sidebar view badge, dashboard top bar, and Radar status bar item. Attention means `waiting_approval` or unread `done`; the Radar status bar item also shows running and visible session counts.
- Reads host-local Codex rate-limit usage through app-server `account/rateLimits/read`, normalizes semantic 5-hour/7-day pools, and keeps the rollout adapter as a local fallback/parity observation for this migration release.
- Distinguishes unread/read done sessions in sidebar cards and the dashboard selected-session inspector.
- Filters the sidebar project section or dashboard project list by display status with a temporary view-local filter.
- Includes an `attention` filter for only attention-worthy sessions.
- Provides a manual refresh command in the view title.
- Opens a sidebar card, double-clicked sidebar row, preview header action, or dashboard-selected session in the official Codex extension via `vscode://openai.chatgpt/local/<session_id>` when a host-local rollout/transcript file can be resolved for that session.
- Detects when the session working directory is outside the current workspace and can ask whether to open that project in a new window or resume the thread here.
- Provides actions to mark done sessions read/unread. Archived sessions cannot be opened through the official Codex handoff.

## Boundaries

- Does not edit `~/.codex/hooks.json`.
- Does not install hooks.
- Does not execute `codex resume`.
- Does not edit `config.json` directly.
- Does not expose retention or prune controls in the current VS Code surface; use the terminal `codex-radar config` and `codex-radar prune` commands for those operations.
- Treats a successful experimental Codex handoff for a done session as a local read acknowledgement only.
- Does not read `events.jsonl` for the default view.
- Does not read raw transcript files or show raw transcript paths in sidebar labels, descriptions, dashboard cards, or inspector fields.
- Shows only a redacted snippet from `sessions.json` cached assistant summary in sidebar/dashboard surfaces.
- Does not send transcript or session metadata outside the extension host.

## Open in Codex Workspace Behavior

`codexRadar.openThreadBehavior` applies only when the selected session's `cwd` is outside the current VS Code workspace:

- `ask` (default): choose `Open Project in New Window`, `Open Here`, or cancel.
- `openWorkspace`: open the session working directory in a new window. Radar does not automatically route the Codex thread across windows; select the session again from Radar in the destination window.
- `openHere`: resume in the current window even when the workspace differs.

The extension preserves the current local, Remote SSH, WSL, or Dev Container URI authority when opening the destination window. Session state records only `cwd`, so this does not reconstruct a historical saved `.code-workspace` or multi-root layout.

## Version Policy

- `package.json` version is the VSIX version.
- `test/packageManifest.test.js` intentionally pins the current manual testing version so release packaging does not happen accidentally after a silent version drift.
- Bump the version for each user-distributed VSIX.
- Keep the [extension changelog](https://github.com/plaonn/codex-radar/blob/main/extensions/vscode/CHANGELOG.md) updated for each packaged version.
- Marketplace publication is a separate release milestone and requires explicit publisher/namespace, account, and asset decisions.

## Install From VSIX

After the `0.4.4` package is published to a GitHub Release, download `codex-radar-vscode-0.4.4.vsix` and install it into the extension host where Codex runs:

```bash
code --install-extension codex-radar-vscode-0.4.4.vsix --force
```

The extension requires the host-local `codex-radar` helper/indexer and a user-configured Codex lifecycle hook that produces `sessions.json`. Follow the root [development and testing guide](https://github.com/plaonn/codex-radar#development-and-testing) and [hook setup runbook](https://github.com/plaonn/codex-radar/blob/main/docs/runbooks/install-hooks.md). The extension does not install hooks or edit `~/.codex/hooks.json`.

For optional thread title/archive enrichment and supported rate-limit usage reads, the extension starts `codex app-server` through a Codex App Server Controller on the extension host. Codex CLI must be installed separately. The VSIX does not bundle Codex and does not reuse the official Codex extension's private bundled executable path. Set `codexRadar.codexExecutable` only when `codex` is not available on the extension host `PATH`.

Maintainers can build the VSIX from the repository root:

```bash
npm --prefix extensions/vscode run package
```

The command writes `extensions/vscode/codex-radar-vscode-<version>.vsix`. VSIX files are gitignored release artifacts and should not be committed.

Install the locally built package into the extension host you want to test:

```bash
code --install-extension extensions/vscode/codex-radar-vscode-0.4.11.vsix --force
```

For Remote SSH, install the VSIX while connected to the remote window so the extension runs on the remote workspace extension host. The manifest declares `extensionKind: ["workspace"]` to keep the default execution host aligned with the remote `codex-radar` state directory.

## Remote SSH Smoke Test

1. Confirm the remote host has `codex-radar` available:

   ```bash
   codex-radar doctor
   codex-radar path
   ```

2. In the Remote SSH VS Code window, install the generated VSIX and reload the window.
3. Open the Codex Radar Activity Bar container.
4. If the state directory or `sessions.json` is intentionally absent, confirm `Projects` shows setup diagnostics instead of a silent empty list.
5. Confirm the sidebar shows native `Attention`, `Projects`, and collapsed `Archived` sections whose bodies are rendered as Webview content.
6. Confirm sidebar bodies start directly with their lists, without duplicate `Attention`, `Projects`, or `Archived` headers inside the Webview body.
7. Confirm sidebar cards show status, model/tool metadata, actions, and redacted snippets from `sessions.json`.
8. Use the `Projects` section title filter button and confirm it changes only the `Projects` section, not the attention badge.
9. In the `Projects` section, confirm project headers are visually prominent, session rows are indented under projects, and quiet projects can fold/unfold their sessions. Quiet projects should start collapsed when no status filter is active.
10. Right-click a session item and confirm the context menu shows `Copy Session ID` instead of edit actions.
11. Use `Codex Radar: Open Dashboard` from the Command Palette.
12. Confirm the editor dashboard shows the attention inbox, project groups, selected-session inspector, status/model/tool metadata, and redacted snippets from `sessions.json`.
13. Confirm `running`/`tool_running` use neutral spinners, unread `done` uses a blue/cyan filled indicator, read `done` uses a hollow gray indicator with muted row treatment, and `unknown` uses a colored `!` indicator.
14. On a done session, mark read and unread from either sidebar card actions or the dashboard inspector.
15. Archive and unarchive a Codex session and confirm it moves into and out of `Archived` automatically without pressing Refresh. Confirm archived sessions are excluded from `Attention` and `Projects` and have `Open in Codex` disabled.
16. Confirm the Radar status bar item shows attention, running, and visible session counts, and opens the dashboard when clicked.
17. Select a sidebar session and confirm the preview opens with a fixed header, bounded transcript bubbles, and an `Open in Codex` button for eligible sessions.
18. Open a session whose `cwd` is inside the current workspace and confirm the Codex handoff does not show a workspace prompt.
19. Open a session from another project with `codexRadar.openThreadBehavior` set to `ask`; confirm the modal can open its project in a new window, open the thread here, or cancel.
20. Confirm `openWorkspace` preserves the current Remote SSH/local extension host, opens only the destination project, and does not change the Codex thread in the source window. In the destination window, select the same session from Radar and confirm the same-workspace Codex handoff works. Treat a Codex URI failure as non-blocking because that route is not a stable public contract.
21. Confirm no hook file, transcript file, `sessions.json`, or `config.json` was edited directly by the extension.

## Release Checklist

- `npm --prefix extensions/vscode test`
- `npm --prefix extensions/vscode run package`
- Inspect package output and confirm `CHANGELOG.md`, `README.md`, `LICENSE.txt`, `package.json`, `media/codex-radar.svg`, and `src/` files are included.
- Install the generated VSIX in a Remote SSH window and complete the smoke test above.
- Attach the VSIX to a GitHub Release only after explicit approval.
- Do not publish to the VS Code Marketplace in this milestone.

## Tests

```bash
npm --prefix extensions/vscode test
```

## Package

```bash
npm --prefix extensions/vscode run package
```

The generated `.vsix` is a local/release artifact. It is ignored by git and should be attached to a release when publishing, not committed to the repository.
