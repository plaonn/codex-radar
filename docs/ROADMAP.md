# codex-radar Roadmap

## Milestone 1: Local Session Index

- `codex-radar hook`으로 hook payload를 수집한다.
- append-only event log와 latest-session cache를 유지한다.
- terminal에서 session list와 transcript skim을 제공한다.
- dependency-free 최소 TUI를 제공한다.

## Milestone 2: Operator UX

- TUI navigation과 transcript preview를 개선한다.
- `tui`에 project/status/model/recency filter controls를 추가할지 검토한다.
- TUI에서 session을 선택하면 같은 terminal에서 `codex resume <session_id>`로 자연스럽게 전환한다.
- session id가 없거나 resume할 수 없는 row는 disabled 처리하고, 필요하면 resume command만 출력한다.

## Milestone 3: Notifications

- 기본값은 notification 없음으로 유지한다.
- 첫 notification 구현은 opt-in local-only watcher에서만 지원한다.
- hook path는 notification을 직접 보내지 않고 event append/cache update만 수행한다.
- 첫 trigger는 `waiting_approval`로 제한한다.
- notification content는 `status`, project basename, event name처럼 최소 metadata만 포함한다.
- prompt, transcript text, transcript path, full cwd, raw payload, command output은 notification content에 포함하지 않는다.
- terminal bell은 foreground watcher/TUI fallback 후보로만 둔다.
- 외부 notification channel은 별도 milestone 전까지 금지한다. 이후에도 explicit opt-in, content template, redaction policy가 먼저 필요하다.

## Parking Lot

- stdlib MVP가 유용하다는 것이 확인된 뒤 Rich/Textual TUI 검토.
- 과거 `~/.codex/sessions` metadata optional import.
- worktree 또는 nested repository용 project alias.
- shell completion.
