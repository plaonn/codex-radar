# codex-radar Roadmap

## Milestone 1: Local Session Index

- Capture hook payloads through `codex-radar hook`.
- Maintain append-only events and latest-session cache.
- List sessions and skim transcripts from the terminal.
- Provide a minimal dependency-free TUI.

## Milestone 2: Operator UX

- Improve TUI navigation and transcript preview.
- Add filters for project, status, model, and recency.
- Add a safe resume command helper that prints or launches `codex resume`.
- Add stale-session detection.

## Milestone 3: Notifications

- Design explicit notification boundaries before implementation.
- Support local-only notification targets first.
- Keep external notification channels opt-in with content redaction controls.

## Parking Lot

- Rich/Textual TUI after the stdlib MVP proves useful.
- Optional import of historical `~/.codex/sessions` metadata.
- Project aliases for worktrees or nested repositories.
- Shell completions.
