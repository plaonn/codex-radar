# Codex Radar VS Code Extension

VS Code surface for extension host-local `codex-radar` session state.

This package is prepared for local VSIX and GitHub Release distribution first. It is not published to the VS Code Marketplace yet.

## Current Scope

- Provides a dedicated Codex Radar Activity Bar container.
- Reads `sessions.json` through a small `SessionSource` adapter.
- Refreshes automatically when `sessions.json` is created, changed, or deleted.
- Splits navigation into native `Attention`, `Projects`, and collapsed `Hidden` sections.
- Shows `waiting_approval`, `stale`, and unread `done` sessions in `Attention`.
- Keeps project-grouped navigation in `Projects`.
- Lets the user hide sessions from Radar and restore them from `Hidden`.
- Shows `waiting_approval`, `running`, `tool_running`, `done`, and `stale` as navigation state, with project attention counts and inbox-like session rows.
- Prefixes rows with a short session id when no readable thread title is available in `sessions.json`.
- Shows the total unfiltered attention count in the VS Code view badge. Attention means `waiting_approval`, `stale`, or unread `done`.
- Distinguishes unread/read done rows with row text and mail-style icons.
- Filters the view by display status with a temporary view-title action.
- Includes an `attention` filter for only attention-worthy sessions.
- Provides a manual refresh command in the view title.
- Opens the same session in the official Codex extension via `vscode://openai.chatgpt/local/<session_id>` when a session row is clicked.
- Provides a done-session row action to mark the session read or unread.
- Lets the user configure server-side `retention_days` through `codex-radar config`.
- Lets the user run server-side pruning through `codex-radar prune`.

## Boundaries

- Does not edit `~/.codex/hooks.json`.
- Does not install hooks.
- Does not execute `codex resume`.
- Does not edit `config.json` directly; retention changes go through the configured `codex-radar` CLI.
- Treats a successful experimental Codex handoff for a done session as a local read acknowledgement only.
- Does not read `events.jsonl` for the default view.
- Does not read raw transcript files or show raw transcript paths in default navigation labels, descriptions, or tooltips.
- Shows only a redacted snippet from `sessions.json` cached assistant summary in default navigation.
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
code --install-extension extensions/vscode/codex-radar-vscode-0.1.13.vsix --force
```

For Remote SSH, install the VSIX while connected to the remote window so the extension runs on the remote workspace extension host. The manifest declares `extensionKind: ["workspace"]` to keep the default execution host aligned with the remote `codex-radar` state directory.

Configure the CLI used by retention and prune actions:

- If `codex-radar` is installed on the VS Code extension host PATH, the default `codexRadar.cliPath` works.
- If the extension host PATH cannot find `codex-radar`, the default command is resolved once more through the remote user's login shell with `command -v codex-radar`.
- If that still cannot find the command, install `codex-radar` for the remote shell or set `codexRadar.cliPath`.
- When the open workspace is a codex-radar source checkout containing `src/codex_radar/cli.py`, the extension can fall back to `python3 -m codex_radar.cli` with `PYTHONPATH=src`. Override that interpreter with `codexRadar.pythonPath` if needed.

## Remote SSH Smoke Test

1. Confirm the remote host has `codex-radar` available:

   ```bash
   codex-radar doctor
   codex-radar path
   ```

2. In the Remote SSH VS Code window, install the generated VSIX and reload the window.
3. Open the Codex Radar Activity Bar container.
4. Confirm sessions are grouped by project and show status, model/tool metadata, and redacted snippets from `sessions.json`.
5. Use the view title actions:
   - Refresh Sessions reloads the cache.
   - Filter by Status changes only the temporary view filter.
   - Configure Retention calls `codex-radar config`.
   - Prune Now calls `codex-radar prune`.
6. On a done session, mark read and unread from the inline mail-style row action.
7. Try `Open in Codex (Experimental)` only as a non-blocking handoff check. A failed handoff does not fail the VSIX smoke test because the URI route is not a stable public contract.
8. Confirm no hook file, transcript file, `sessions.json`, or `config.json` was edited directly by the extension except through explicit retention CLI actions.

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
