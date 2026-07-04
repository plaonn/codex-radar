# Codex Radar VS Code Extension

Minimal VS Code surface for extension host-local `codex-radar` session state.

Current scope:

- Provides a dedicated Codex Radar Activity Bar container.
- Reads `sessions.json` through a small `SessionSource` adapter.
- Refreshes automatically when `sessions.json` is created, changed, or deleted.
- Groups sessions by `project`.
- Shows `waiting_approval`, `running`, `tool_running`, `done`, and `stale` as navigation state, with project attention counts and inbox-like session rows.
- Prefixes rows with a short session id when no readable thread title is available in `sessions.json`.
- Shows the total unfiltered attention count in the VS Code view badge. Attention means `waiting_approval`, `stale`, or unread `done`.
- Distinguishes unread/read done rows with row text and mail-style icons.
- Filters the view by display status with a temporary view-title action.
- Provides a manual refresh command in the view title.
- Opens the same session in the official Codex extension via `vscode://openai.chatgpt/local/<session_id>` when a session row is clicked.
- Provides a done-session row action to mark the session read or unread.
- Lets the user configure server-side `retention_days` through `codex-radar config`.
- Lets the user run server-side pruning through `codex-radar prune`.

Boundaries:

- Does not edit `~/.codex/hooks.json`.
- Does not install hooks.
- Does not execute `codex resume`.
- Does not edit `config.json` directly; retention changes go through the configured `codex-radar` CLI.
- Treats a successful experimental Codex handoff for a done session as a local read acknowledgement only.
- Does not read `events.jsonl` for the default view.
- Does not read raw transcript files or show raw transcript paths in default navigation labels, descriptions, or tooltips.
- Shows only a redacted snippet from `sessions.json` cached assistant summary in default navigation.
- Does not send transcript or session metadata outside the extension host.

Run tests:

```bash
npm --prefix extensions/vscode test
```

Package a local VSIX:

```bash
npm --prefix extensions/vscode run package
```

The generated `.vsix` is a local/release artifact. It is ignored by git and should be attached to a release when publishing, not committed to the repository.
