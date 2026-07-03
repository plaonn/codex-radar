# codex-radar Roadmap

## Milestone 1: Local Session Index

- `codex-radar hook`으로 hook payload를 수집한다.
- append-only event log와 latest-session cache를 유지한다.
- terminal에서 session list와 transcript skim을 제공한다.
- dependency-free 최소 TUI를 제공한다.

## Milestone 2: Operator UX

- TUI navigation과 transcript preview를 개선한다.
- project, status, model, recency filter를 추가한다.
- TUI에서 session을 선택하면 같은 terminal에서 `codex resume <session_id>`로 자연스럽게 전환한다.
- session id가 없거나 resume할 수 없는 row는 disabled 처리하고, 필요하면 resume command만 출력한다.
- stale session detection을 추가한다.

## Milestone 3: Notifications

- 구현 전에 notification boundary를 명시적으로 설계한다.
- local-only notification target을 먼저 지원한다.
- 외부 notification channel은 opt-in으로 두고 content redaction control을 둔다.

## Parking Lot

- stdlib MVP가 유용하다는 것이 확인된 뒤 Rich/Textual TUI 검토.
- 과거 `~/.codex/sessions` metadata optional import.
- worktree 또는 nested repository용 project alias.
- shell completion.
