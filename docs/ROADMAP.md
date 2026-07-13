# codex-radar Roadmap

## Notifications

- 기본값은 notification 없음으로 유지한다.
- 주요 future surface는 VS Code extension 같은 GUI 통합이다.
- GUI 통합의 primary navigation은 프로젝트 단위로 묶인 conversation list여야 한다.
- notification은 GUI 통합 안에서 thread 상태와 함께 다룰 수 있다.
- `codex-radar watch`는 terminal에서 직접 실행하는 MVP/fallback 알림 표면으로 유지하며, 최종 GUI 통합 요구사항을 충족한 것으로 보지 않는다.
- 모바일 알림의 첫 scope는 앱이 foreground이고 SSH/RPC 연결이 살아 있을 때의 in-app attention event와 tap-to-thread navigation으로 둔다.
- OS notification이나 외부 notification channel은 별도 milestone 전까지 금지한다.
- OS/external notification을 추가하려면 explicit opt-in, content template, redaction policy가 먼저 필요하다.

## GUI Integration Criteria

- VS Code extension은 이 repository 안의 `extensions/vscode/` subtree에서 시작한다.
- Python core는 stdlib-first를 유지하고, Node/extension dependency는 extension subtree에 격리한다.
- 현재 GUI milestone은 `sessions.json`을 직접 읽는 sectioned Webview sidebar와 editor Webview dashboard의 hybrid surface다.
- GUI implementation은 read adapter를 통해 state source를 캡슐화하고, 나중에 `codex-radar sessions --json` 또는 별도 `export/gui-state` command로 전환할 수 있어야 한다.
- GUI는 thread 상태(`waiting_approval`, `running`, `tool_running`, `done`, `unknown`)와 Codex archived state를 navigation 안에서 구분해야 한다.
- 첫 GUI notification surface는 sidebar section badge와 dashboard count/highlight 같은 in-surface cue로 제한한다.
- 첫 GUI action boundary는 Codex/codex-radar runtime state에 대해 read-only dashboard/sidebar다. Extension-local read/unread UI state는 허용하지만 VS Code GUI에서는 retention config/prune controls를 노출하지 않고 terminal CLI workflow에 맡긴다. 직접 `codex resume` 실행은 후속 requirement로 다룬다.
- GUI integration은 transcript/session metadata를 외부로 전송하지 않고 R6 privacy boundary를 유지해야 한다.
- CLI/export contract로 전환하는 시점은 schema evolution, computed field 증가, redaction/display policy 복잡화, cross-platform path 문제가 커질 때 재검토한다.

## VS Code Extension Release

- 현재 distribution stage는 `0.4.3` public beta이며, GitHub Release에 VSIX를 attached artifact로 배포한다.
- GitHub Release readiness와 Marketplace publish는 별도 milestone로 유지한다.
- Public beta release readiness에는 version policy, README/install guide, extension icon/branding, privacy boundary copy, changelog, packaged VSIX, Remote SSH install smoke test를 포함한다.
- GitHub Release 기반 설치와 upgrade 경로를 public beta 동안 먼저 안정화한다.
- Marketplace publish는 publisher/namespace, marketplace metadata, asset policy, release 운영 방식이 정해진 뒤 별도 milestone으로 진행한다.

## Local Runtime / Distribution Direction

- 장기 배포 모델은 VS Code extension을 `codex-radar` runtime owner로 만들기보다, host-local `codex-radar` indexer/runtime을 core로 두고 VS Code extension, future Android app, TUI, CLI를 client surface로 분리하는 방향을 우선 검토한다.
- Extension-only scan mode는 설치가 단순하더라도 `waiting_approval`, `tool_running`, `done` 같은 lifecycle-derived attention state의 source of truth가 약해지므로 primary architecture로 두지 않는다. 필요하면 lightweight history/preview fallback으로만 검토한다.
- Windows local-only 배포를 다룰 때도 Python vs Node helper, extension-bundled helper, separate CLI package 같은 선택은 implementation/distribution choice로 남기고, requirement는 stable local runtime/indexer와 explicit setup/migration boundary로 둔다.
- Hook integration은 stable entrypoint/shim을 지향한다. Helper implementation 업데이트는 가능한 한 hook config 변경 없이 처리하고, event wiring이나 command contract 변경처럼 `hooks.json` migration이 필요한 경우에는 diff/preview와 사용자 승인을 요구한다.
- Setup UX는 extension 하나를 설치한 사용자가 빈 dashboard만 보지 않도록 missing/outdated indexer, missing hook wiring, inaccessible state directory를 명확히 진단하는 방향으로 발전시킨다.

## Mobile Direction

- 모바일의 장기 surface는 Android app이지만, 초기 bridge는 별도 remote HTTP server보다 SSH 위의 machine-readable `codex-radar` protocol을 우선 검토한다.
- 모바일 앱의 primary use case는 사용자가 앱을 열고 여러 프로젝트의 Codex thread를 집중적으로 훑고 전환하는 foreground cockpit이다.
- 앱이 닫혔거나 SSH 연결이 끊긴 동안 notification delivery를 보장하는 것은 초기 목표가 아니다. 그런 알림은 공식 ChatGPT/Codex app 또는 별도 push notification milestone의 역할로 둔다.
- 모바일 앱은 SSH session에서 `codex-radar rpc` 같은 전용 process를 실행하고 newline-delimited JSON request/response/event를 주고받는 구조를 선호한다. 이 방식은 shell quoting 문제를 줄이고 stdout을 protocol 전용으로 유지할 수 있다.
- RPC contract는 project/thread list, status/attention/running/done/archived counts, bounded redacted preview, read/unread 같은 가벼운 local action, foreground attention event를 우선한다.
- Foreground attention event는 사용자가 다른 thread를 보고 있을 때 `done`, `waiting_approval`, `running -> done` 같은 변화를 in-app banner/toast로 보여주고, tap하면 해당 thread로 이동하게 한다.
- TUI는 모바일의 primary path가 아니라 VS Code도 Android app도 없는 SSH-only 환경을 위한 lightweight fallback dashboard로 유지한다.
- Shared state builder는 VS Code extension, TUI fallback, future mobile RPC가 같은 sanitized display model과 privacy boundary를 재사용할 수 있게 설계한다.

## Parking Lot

- stdlib MVP가 유용하다는 것이 확인된 뒤 Rich/Textual TUI 검토. 다만 TUI는 primary product surface가 아니라 SSH-only/headless fallback으로 제한한다.
- 과거 `~/.codex/sessions` metadata optional import.
- worktree 또는 nested repository용 project alias.
- Sectioned Webview sidebar, editor preview, editor dashboard가 Remote SSH에서 안정화된 뒤 command-copy, terminal handoff, 또는 retention controls를 별도 opt-in milestone로 검토.
- Editor preview transcript에서 latest bounded window를 넘어 과거 메시지를 볼 수 있도록 lazy loading, `Load older`, 또는 full transcript mode를 검토. 구현 전에는 scroll anchoring, privacy/redaction boundary, large transcript DOM cost를 함께 설계한다.
- terminal CLI/TUI용 `stale_after_minutes` 같은 stale freshness threshold config를 검토. 기본값은 현재 30분이다.
