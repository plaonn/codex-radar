# Native Windows Real-Host Validation

## Outcome

The Native Windows real-host milestone passed on 2026-07-27 for the exact
helper `0.4.8` + VSIX `0.4.18` pair. A fresh Codex lifecycle turn updated the
host-local `sessions.json`, and the same unique smoke marker appeared in the
Codex Radar Sidebar Preview on that Windows host.

This closes the M3 platform-foundation proof. It does not expand the supported
scope of a previously published release or authorize a Windows release,
Marketplace/PyPI publication, signed installer, or package-manager channel.

## Tested Boundary

- Native Windows PowerShell under the same user profile used by Codex and
  VS Code; the shell happened to be elevated, but the helper did not require
  administrator or symlink privileges.
- Python `3.14.4`.
- Codex CLI `0.144.5`.
- VS Code `1.108.2`.
- Helper runtime `0.4.8`.
- VSIX `0.4.18`.
- Helper bundle SHA-256:
  `7ea370e6666c11fc8348c1a3fb563855ab6e635c59f11b8a588d0e3f2f34ce5a`.
- VSIX SHA-256:
  `131cfa0fa332c98762ae094471e1984f279478841778f548ec71609b25ffb647`.

## Evidence

1. The helper upgraded from runtime `0.4.7` to `0.4.8` while retaining both
   immutable versions and selecting `0.4.8` as current.
2. `hook-config --hooks-file ...` produced a no-write preview; the hooks file
   SHA-256 remained unchanged.
3. Explicit `hook-config --apply` preserved unrelated user hooks, created an
   adjacent backup whose hash matched the original file, and reported all six
   managed events as `stable`.
4. A second identical apply returned `unchanged` and preserved the applied
   hooks-file hash, demonstrating that Radar entries did not accumulate.
5. `codex-radar-helper diagnose` reported the runtime, all stable shims, hook
   wiring, and overall status as `ready`.
6. The VSIX checksum matched, installation reported
   `plaonn.codex-radar-vscode@0.4.18`, and a fresh interactive Codex turn
   returned the unique ASCII smoke marker.
7. Before that turn the bounded baseline contained zero indexed sessions.
   After the turn, `sessions.json` had one new session with status `done` and a
   newer write timestamp.
8. After reloading and refreshing VS Code, Codex Radar showed that newest
   session and its Preview contained the exact smoke marker.

## Privacy and Scope

- No private absolute path, full session ID, prompt history, transcript body,
  credential, or raw hook payload is retained in this record.
- WSL2 and Remote SSH were not used as substitutes for Native Windows.
- The smoke validates the exact tested pair. Later helper or VSIX changes need
  Windows regression coverage proportional to the changed surface.
- Published `v0.4.19` remains a POSIX-supported public-beta distribution until
  a separate Windows release/support decision and release-scoped evidence.
