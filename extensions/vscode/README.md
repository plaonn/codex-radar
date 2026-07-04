# Codex Radar VS Code Extension

Minimal read-only VS Code surface for extension host-local `codex-radar` session state.

Current scope:

- Reads `sessions.json` through a small `SessionSource` adapter.
- Refreshes automatically when `sessions.json` is created, changed, or deleted.
- Groups sessions by `project`.
- Shows `waiting_approval`, `running`, `tool_running`, `done`, and `stale` as navigation state, with project attention counts and compact session rows.
- Shows the total unfiltered attention count in the VS Code view badge.
- Filters the view by display status with a temporary view-title action.
- Provides a manual refresh command in the view title.
- Opens a readonly transcript preview document from an explicit session row action. The preview uses a recent redacted skim for identification, not the raw transcript.
- Provides an experimental session row action to open the same session in the official Codex extension via `vscode://openai.chatgpt/local/<session_id>`.

Boundaries:

- Does not edit `~/.codex/hooks.json`.
- Does not install hooks.
- Does not execute `codex resume`.
- Does not treat the experimental Codex handoff as acknowledgement or completion handling.
- Does not read `events.jsonl` for the default view.
- Does not show transcript content or raw transcript paths in default navigation labels, descriptions, or tooltips.
- Does not send transcript or session metadata outside the extension host.

Run tests:

```bash
npm --prefix extensions/vscode test
```
