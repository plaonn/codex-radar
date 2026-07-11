<p align="center">
  <a href="README.md"><strong>English</strong></a> | <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <img src="extensions/vscode/media/codex-radar.png" width="128" alt="Codex Radar icon">
</p>

<h1 align="center">Codex Radar</h1>

<p align="center">
  <strong>Your Codex threads, organized by project.</strong><br>
  See what is running, what needs attention, and resume in the right workspace.
</p>

<p align="center"><strong>Public Beta · v0.4.0</strong></p>

Codex Radar is a local dashboard for people who use Codex across multiple projects, especially in VS Code Remote SSH environments. It groups threads by project, surfaces approval requests and completed work, provides bounded conversation previews, and helps hand eligible threads back to the official Codex extension in the appropriate workspace.

The public beta is distributed as a VSIX through the [v0.4.0 GitHub Release](https://github.com/plaonn/codex-radar/releases/tag/v0.4.0). It is not published to the VS Code Marketplace or PyPI.

## Highlights

- Dedicated VS Code Activity Bar views for `Attention`, `Projects`, and `Archived`, plus an editor dashboard.
- Project-grouped navigation with clear running, approval, done/read, unknown, stale, and archived states.
- Bounded, redacted transcript previews with a cached-summary fallback.
- Workspace-aware `Open in Codex` handoff for eligible threads, including Remote SSH windows.
- Setup diagnostics for missing, empty, stale, invalid, or unsupported local indexes.
- Dependency-free Python CLI and TUI for terminal and headless workflows.
- Configurable local retention and an opt-in foreground terminal watcher.

## How It Works

Codex Radar has two host-local parts. The helper/indexer receives explicitly configured Codex lifecycle hook events and maintains the latest known state for each thread. The VS Code extension is a read-only client of that local index; it is not an extension-only product and does not create the index by itself.

```text
Codex lifecycle events
  -> codex-radar hook
  -> host-local sessions.json
  -> VS Code extension / CLI / TUI
```

The index records observed lifecycle state rather than an authoritative live process state. For example, `waiting_approval` means Radar observed a permission request, `done` means it observed a stop event, and `stale` is a display status for an active-looking session with no recent hook update.

State is stored in the first applicable location:

```text
$CODEX_RADAR_HOME
$XDG_STATE_HOME/codex-radar
~/.local/state/codex-radar
```

See the [session cache v1 schema](docs/schemas/session-cache-v1.schema.json) and [example index](examples/sessions.json) for the current read contract.

## Requirements

- Python 3.9 or later on the host where Codex runs.
- Codex with lifecycle hook support and permission to configure `~/.codex/hooks.json`.
- VS Code 1.90 or later for the extension.
- The official Codex extension for `Open in Codex` handoff.

For Remote SSH, install the helper, configure the hook, and install the VSIX on the remote extension host. Codex Radar reads state and transcripts from that host. Native Windows-only distribution is not part of the current documented public beta; WSL and Dev Container URI authority are preserved by workspace handoff, but those environments have not replaced the Remote SSH-focused workflow.

## Install the Helper

The helper is currently installed from a source checkout; there is no PyPI package.

```bash
git clone --branch v0.4.0 --depth 1 https://github.com/plaonn/codex-radar.git
cd codex-radar
python3 -m venv .venv
. .venv/bin/activate
python -m pip install .
```

Verify that the helper is available on the same host and in the same shell environment used by Codex:

```bash
codex-radar doctor
codex-radar path
```

## Configure the Codex Hook

Hook setup is explicit. Codex Radar does not install hooks, edit `~/.codex/hooks.json`, or overwrite unrelated hooks.

1. Review [`examples/hooks.json`](examples/hooks.json).
2. Merge its `hooks` object into `~/.codex/hooks.json` on the host where Codex runs.
3. Start or resume Codex. If hook review is requested, inspect and trust the hook through `/hooks`.
4. Run a short Codex turn, then verify the index:

   ```bash
   codex-radar sessions
   codex-radar tui
   ```

Follow the complete [hook installation runbook](docs/runbooks/install-hooks.md), including removal instructions.

## Install the VSIX

Download [`codex-radar-vscode-0.4.0.vsix`](https://github.com/plaonn/codex-radar/releases/download/v0.4.0/codex-radar-vscode-0.4.0.vsix) from the [v0.4.0 Public Beta release](https://github.com/plaonn/codex-radar/releases/tag/v0.4.0), then install it into the VS Code extension host where Codex and Radar state live:

```bash
code --install-extension codex-radar-vscode-0.4.0.vsix --force
```

For Remote SSH, connect to the remote window before installing the VSIX so the workspace extension runs beside the remote helper and index. Reload the window, then open **Codex Radar** from the Activity Bar.

## Usage

The VS Code sidebar keeps attention-worthy work and project groups visible. Use **Codex Radar: Open Dashboard** for the larger dashboard, select a session for its preview, and use **Open in Codex** for eligible non-archived threads. When a thread belongs to another workspace, the default `codexRadar.openThreadBehavior` setting asks whether to open that project in a new window or continue in the current window.

The terminal interface provides the same local index as a fallback:

```bash
codex-radar sessions
codex-radar sessions --group-project
codex-radar sessions --model gpt-5 --since 2h
codex-radar sessions --status stale
codex-radar transcript <session-id>
codex-radar tui --project codex-radar --since 1d
codex-radar watch
codex-radar usage
```

Retention applies only to Radar's session index and defaults to seven days. It does not delete Codex transcripts, official threads, or archive state.

```bash
codex-radar config get retention_days
codex-radar config set retention_days 14
codex-radar prune --dry-run
codex-radar prune
```

Shell completion scripts are available for Bash, Zsh, and Fish:

```bash
codex-radar completion zsh > ~/.zfunc/_codex-radar
codex-radar completion bash > ~/.local/share/bash-completion/completions/codex-radar
codex-radar completion fish > ~/.config/fish/completions/codex-radar.fish
```

## Privacy and Security

- Session metadata, transcript-derived previews, and usage snapshots remain on the extension host; Codex Radar does not provide cloud sync.
- The default index stores only the latest known state per thread and does not keep a raw hook event log.
- Sidebar and dashboard surfaces use sanitized metadata and redacted snippets. They do not display raw transcript paths.
- The extension watches `sessions.json` read-only. It does not edit hooks, transcripts, the session index, or server-side `config.json`.
- The experimental usage adapter reads host-local Codex rollout logs without reading `auth.json`, making server requests, or storing raw rollout content.
- Transcript and session data are sensitive local data. Review the hook configuration and protect the Radar state directory accordingly.

## Current Limitations

- Public beta distribution is through GitHub Releases only, not the VS Code Marketplace or PyPI.
- The extension requires the separately installed host-local helper/indexer and explicit hook setup.
- `Open in Codex` uses an experimental local URI route and may be unavailable for some sessions.
- Archived sessions cannot be opened through the Codex handoff.
- Conversation previews are bounded and do not replace Codex's native transcript view.
- There are no OS or external notifications. The VS Code attention views and opt-in terminal watcher are the available cues.
- Lifecycle status is based on the most recently observed hook event, not continuous process monitoring.

## Development and Testing

For an editable development install:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .
```

Run the Python and extension test suites:

```bash
PYTHONPATH=src python3 -m unittest discover
python3 -m compileall src tests
npm --prefix extensions/vscode test
```

Maintainers can package a local VSIX with:

```bash
npm --prefix extensions/vscode run package
```

The generated `extensions/vscode/codex-radar-vscode-<version>.vsix` is a gitignored release artifact and should not be committed. See the [extension guide](extensions/vscode/README.md) for the Remote SSH smoke test and release checklist.

## Release and Distribution

The current release is [Codex Radar 0.4.0 Public Beta](https://github.com/plaonn/codex-radar/releases/tag/v0.4.0). GitHub Release assets are the supported public beta distribution path. Marketplace and PyPI publication remain separate future decisions.

See the [0.4.0 release notes](docs/releases/0.4.0.md) and [extension changelog](extensions/vscode/CHANGELOG.md) for details.

## Documentation and Support

- [Requirements](docs/REQUIREMENTS.md)
- [Current specification](docs/SPEC.md)
- [Roadmap](docs/ROADMAP.md)
- [Hook installation runbook](docs/runbooks/install-hooks.md)
- [VS Code extension guide](extensions/vscode/README.md)
- [Report a bug or request a feature](https://github.com/plaonn/codex-radar/issues)
- [MIT License](LICENSE)
