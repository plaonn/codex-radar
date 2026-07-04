# codex-radar Roadmap

## Notifications

- 기본값은 notification 없음으로 유지한다.
- 주요 future surface는 VS Code extension 같은 GUI 통합이다.
- GUI 통합의 primary navigation은 프로젝트 단위로 묶인 conversation list여야 한다.
- notification은 GUI 통합 안에서 thread 상태와 함께 다룰 수 있다.
- `codex-radar watch`는 terminal에서 직접 실행하는 MVP/fallback 알림 표면으로 유지하며, 최종 GUI 통합 요구사항을 충족한 것으로 보지 않는다.
- OS notification이나 외부 notification channel은 별도 milestone 전까지 금지한다.
- OS/external notification을 추가하려면 explicit opt-in, content template, redaction policy가 먼저 필요하다.

## GUI Integration Criteria

- VS Code extension은 이 repository 안의 `extensions/vscode/` subtree에서 시작한다.
- Python core는 stdlib-first를 유지하고, Node/extension dependency는 extension subtree에 격리한다.
- 첫 GUI milestone은 `sessions.json`을 직접 읽는 GUI read contract v1로 시작한다.
- GUI implementation은 read adapter를 통해 state source를 캡슐화하고, 나중에 `codex-radar sessions --json` 또는 별도 `export/gui-state` command로 전환할 수 있어야 한다.
- GUI는 thread 상태(`waiting_approval`, `running`, `done`, `stale`)를 navigation 안에서 구분해야 한다.
- 첫 GUI notification surface는 project grouping 안의 badge/highlight 같은 in-surface cue로 제한한다.
- 첫 GUI action boundary는 session/transcript navigation에 대해 read-only dashboard다. retention config/prune은 Python core CLI를 통한 server-side action으로 허용한다. 직접 `codex resume` 실행은 후속 requirement로 다룬다.
- GUI integration은 transcript/session metadata를 외부로 전송하지 않고 R6 privacy boundary를 유지해야 한다.
- CLI/export contract로 전환하는 시점은 schema evolution, computed field 증가, redaction/display policy 복잡화, cross-platform path 문제가 커질 때 재검토한다.

## VS Code Extension Release

- 정식 VS Code extension 출시는 GUI surface가 Remote SSH와 official Codex handoff에서 유용하다는 검증 뒤의 staged milestone으로 둔다.
- Release readiness는 marketplace publish와 분리한다.
- Release readiness에는 version policy, README/install guide, extension icon/branding, privacy boundary copy, changelog, packaged VSIX, Remote SSH install smoke test를 포함한다.
- GitHub Release에 VSIX를 attached artifact로 배포하는 경로를 먼저 안정화한다.
- Marketplace publish는 publisher/namespace, marketplace metadata, asset policy, release 운영 방식이 정해진 뒤 별도 milestone으로 진행한다.

## Parking Lot

- stdlib MVP가 유용하다는 것이 확인된 뒤 Rich/Textual TUI 검토.
- 과거 `~/.codex/sessions` metadata optional import.
- worktree 또는 nested repository용 project alias.
