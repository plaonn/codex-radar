# codex-radar Roadmap

## Notifications

- 기본값은 notification 없음으로 유지한다.
- 주요 future surface는 VS Code extension 같은 GUI 통합이다.
- notification은 GUI 통합 안에서 thread 상태와 함께 다룰 수 있다.
- `codex-radar watch`는 terminal에서 직접 실행하는 MVP/fallback 알림 표면으로 유지하며, 최종 GUI 통합 요구사항을 충족한 것으로 보지 않는다.
- OS notification이나 외부 notification channel은 별도 milestone 전까지 금지한다.
- OS/external notification을 추가하려면 explicit opt-in, content template, redaction policy가 먼저 필요하다.

## Parking Lot

- stdlib MVP가 유용하다는 것이 확인된 뒤 Rich/Textual TUI 검토.
- 과거 `~/.codex/sessions` metadata optional import.
- worktree 또는 nested repository용 project alias.
