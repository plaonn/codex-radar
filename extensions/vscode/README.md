# Codex Radar VS Code Extension

Minimal read-only VS Code surface for local `codex-radar` session state.

Current scope:

- Reads `sessions.json` through a small `SessionSource` adapter.
- Groups sessions by `project`.
- Shows `waiting_approval`, `running`, `tool_running`, `done`, and `stale` as navigation state.
- Provides a manual refresh command.

Boundaries:

- Does not edit `~/.codex/hooks.json`.
- Does not install hooks.
- Does not execute `codex resume`.
- Does not read `events.jsonl` for the default view.
- Does not send transcript or session metadata outside the local machine.

Run tests:

```bash
npm --prefix extensions/vscode test
```
