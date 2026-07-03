# codex-radar Instructions

This repository builds a local monitor for Codex sessions.

Before editing:
- Read this file.
- Read `docs/SPEC.md` for current behavior and contracts.
- Read `docs/ROADMAP.md` when changing future direction or scope.
- Read `docs/TASKS.md` before selecting or claiming follow-up work.

Engineering rules:
- Keep the hook path fast, local, and dependency-light.
- Treat Codex transcripts as sensitive local data. Do not commit transcripts, session state, raw hook logs, private paths, secrets, or generated runtime state.
- Prefer append-only event capture plus derived cache files over in-place event mutation.
- Keep global Codex config changes out of tests and normal development commands. Provide examples/runbooks instead of modifying `~/.codex/hooks.json` automatically.
- Use stdlib-first Python unless a requirement in `docs/SPEC.md` justifies a dependency.

Verification:
- Run `PYTHONPATH=src python3 -m unittest discover` after code changes.
- Run `python3 -m compileall src tests` after structural Python changes.
