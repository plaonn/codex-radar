# codex-radar

A terminal radar for local Codex sessions.

`codex-radar` watches Codex lifecycle hooks, indexes local session metadata by
project, and gives you a fast terminal workflow for checking status or skimming
recent conversations.

## Status

Early local MVP. The hook indexer, session list, transcript skim, and
dependency-free TUI are scaffolded. Notification delivery and automatic hook
installation are intentionally out of scope until their privacy boundaries are
specified.

## Install for Development

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .
```

## Commands

```bash
codex-radar hook              # record one hook JSON payload from stdin
codex-radar sessions          # list indexed sessions
codex-radar transcript <id>   # skim a transcript by session id or path
codex-radar tui               # open the terminal dashboard
codex-radar path              # print state directory
codex-radar doctor            # print a short diagnostic
```

Runtime state defaults to `$CODEX_RADAR_HOME`,
`$XDG_STATE_HOME/codex-radar`, or `~/.local/state/codex-radar`.

## Hook Setup

See [docs/runbooks/install-hooks.md](docs/runbooks/install-hooks.md).

`examples/hooks.json` shows a user-level Codex hook config that routes
`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
`PermissionRequest`, and `Stop` events into `codex-radar hook`.

## RDD Surfaces

- [docs/SPEC.md](docs/SPEC.md): current behavior, requirements, data model, and
  automation/privacy boundary.
- [docs/ROADMAP.md](docs/ROADMAP.md): future direction and non-goals.
- [docs/TASKS.md](docs/TASKS.md): active RDD task dashboard.

## Verify

```bash
PYTHONPATH=src python3 -m unittest discover
python3 -m compileall src tests
```
