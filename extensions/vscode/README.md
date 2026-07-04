# Codex Radar VS Code Extension

Minimal read-only VS Code surface for extension host-local `codex-radar` session state.

Current scope:

- Reads `sessions.json` through a small `SessionSource` adapter.
- Refreshes automatically when `sessions.json` is created, changed, or deleted.
- Groups sessions by `project`.
- Shows `waiting_approval`, `running`, `tool_running`, `done`, and `stale` as navigation state, with project attention counts and compact session rows.
- Filters the view by display status with a temporary view-title action.
- Provides a manual refresh command in the view title.
- Opens a readonly transcript preview document from an explicit session row action. The preview uses a recent redacted skim for identification, not the raw transcript.

Boundaries:

- Does not edit `~/.codex/hooks.json`.
- Does not install hooks.
- Does not execute `codex resume`.
- Does not read `events.jsonl` for the default view.
- Does not show transcript content or raw transcript paths in default navigation labels, descriptions, or tooltips.
- Does not send transcript or session metadata outside the extension host.

Run tests:

```bash
npm --prefix extensions/vscode test
```
