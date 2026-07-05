# Codex Radar VS Code Extension

VS Code surface for extension host-local `codex-radar` session state.

This package is prepared for local VSIX and GitHub Release distribution first. It is not published to the VS Code Marketplace yet.

## Current Scope

- Provides a dedicated Codex Radar Activity Bar container.
- Reads `sessions.json` through a small `SessionSource` adapter.
- Refreshes automatically when `sessions.json` is created, changed, or deleted.
- Provides native collapsible sidebar sections for `Attention`, `Projects`, and collapsed `Hidden`, with each section body rendered by a Webview.
- Provides `Codex Radar: Open Dashboard` to open a richer Webview dashboard in an editor tab.
- Shows `waiting_approval`, `stale`, and unread `done` sessions in the sidebar and dashboard attention inbox.
- Keeps project-grouped navigation in the sidebar `Projects` section and dashboard project list.
- Lets the user hide sessions from Radar and restore them from the sidebar `Hidden` section or dashboard hidden list.
- Shows `waiting_approval`, `running`, `tool_running`, `done`, and `stale` as sidebar/dashboard state, with project attention counts and inbox-like session rows/cards.
- Prefixes rows/cards with a short session id when no readable thread title is available in `sessions.json`.
- Shows the total unfiltered attention count in the sidebar view badge and dashboard top bar. Attention means `waiting_approval`, `stale`, or unread `done`.
- Distinguishes unread/read done sessions in sidebar cards and the dashboard selected-session inspector.
- Filters the sidebar project section or dashboard project list by display status with a temporary view-local filter.
- Includes an `attention` filter for only attention-worthy sessions.
- Provides a manual refresh command in the view title.
- Opens a sidebar card or dashboard-selected session in the official Codex extension via `vscode://openai.chatgpt/local/<session_id>`.
- Provides actions to mark done sessions read/unread and hide/restore sessions.

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

## Version Policy

- `package.json` version is the VSIX version.
- `test/packageManifest.test.js` intentionally pins the current manual testing version so release packaging does not happen accidentally after a silent version drift.
- Bump the version for each user-distributed VSIX.
- Keep [CHANGELOG.md](CHANGELOG.md) updated for each packaged version.
- Marketplace publication is a separate release milestone and requires explicit publisher/namespace, account, and asset decisions.

## Install From VSIX

Build the local VSIX from the repository root:

```bash
npm --prefix extensions/vscode run package
```

The command writes `extensions/vscode/codex-radar-vscode-<version>.vsix`. VSIX files are gitignored release artifacts and should not be committed.

Install into the extension host you want to test:

```bash
code --install-extension extensions/vscode/codex-radar-vscode-0.2.2.vsix --force
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
4. Confirm the sidebar shows native `Attention`, `Projects`, and collapsed `Hidden` sections whose bodies are rendered as Webview content.
5. Confirm sidebar cards show status, model/tool metadata, actions, and redacted snippets from `sessions.json`.
6. Use the sidebar status filter and confirm it changes only the `Projects` section, not the attention badge.
7. Use `Codex Radar: Open Dashboard` from the Command Palette or sidebar title action.
8. Confirm the editor dashboard shows the attention inbox, project groups, selected-session inspector, status/model/tool metadata, and redacted snippets from `sessions.json`.
9. On a done session, mark read and unread from either sidebar card actions or the dashboard inspector.
10. Hide a session, then restore it from `Hidden` or the dashboard hidden list.
11. Try `Open in Codex (Experimental)` only as a non-blocking handoff check. A failed handoff does not fail the VSIX smoke test because the URI route is not a stable public contract.
12. Confirm no hook file, transcript file, `sessions.json`, or `config.json` was edited directly by the extension.

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
