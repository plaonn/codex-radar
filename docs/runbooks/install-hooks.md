# Install Codex Hooks

This runbook installs `codex-radar` as a user-level Codex hook.

## Preconditions

- `codex-radar` is installed in the shell environment Codex uses.
- You understand that Codex hook payloads and session transcripts can contain private local data.

For local development:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .
```

## Inspect Example Hook Config

```bash
sed -n '1,220p' examples/hooks.json
```

## Install Manually

Merge `examples/hooks.json` into:

```text
~/.codex/hooks.json
```

If `~/.codex/hooks.json` already exists, merge the `hooks` object instead of replacing unrelated hooks.

## Trust Hooks

Start or resume Codex, then use `/hooks` in Codex if it asks you to review changed hooks.

## Verify

Run a short Codex turn, then check:

```bash
codex-radar sessions
codex-radar tui
```

State files should appear below:

```bash
codex-radar path
```

## Uninstall

Remove the `codex-radar hook` entries from `~/.codex/hooks.json`.
