# codex-radar Requirements

## Root Goal

`codex-radar`는 추가 프로그램 설치가 어려운 원격 개발 환경에서 VS Code Remote SSH와 remote environment 안의 Codex를 함께 사용할 때, Codex thread를 프로젝트 단위로 구분하고, 대기/완료/승인요청 상태와 확인할 가치가 있는 최근 transcript를 빠르게 파악하게 해준다.

## Requirement Hierarchy

### R0: 원격 Codex thread visibility

- Status: confirmed
- Requirement: 추가 프로그램 설치가 어려운 원격 개발 환경에서 VS Code Remote SSH와 remote environment 안의 Codex를 함께 사용할 때, Codex thread의 프로젝트 소속, 상태, 확인 필요성을 빠르게 파악할 수 있어야 한다.
- Rationale: VS Code용 Codex extension만으로는 여러 repository의 thread를 프로젝트 단위로 구분하고 상태를 한눈에 파악하기 어렵다.
- Failure prevented: 어느 Codex 대화가 어느 repository 작업인지 잃어버리거나, 승인요청/완료/대기 thread를 놓치는 상태.
- Assumptions: Codex lifecycle hook이 session과 transcript metadata를 제공한다.
- Revisit when: Codex extension 또는 Codex App이 프로젝트별 thread grouping과 충분한 상태 알림을 직접 제공할 때.

### R1: 프로젝트 단위 thread navigation

- Status: confirmed
- Requirement: 대화 목록은 프로젝트 단위로 구분되어야 하며, 사용자가 프로젝트 기준으로 thread를 좁혀보거나 전환할 수 있어야 한다.
- Rationale: VS Code용 Codex extension의 대화 목록은 Codex App처럼 프로젝트 단위로 구분되어 보이지 않아 repository별 thread switching이 어렵다.
- Failure prevented: VS Code 안의 Codex 대화 목록에서 프로젝트별 thread를 찾거나 전환하기 어려운 문제.
- Derived specs/tests: `project` field, project column, TUI project group headers, `sessions --group-project`, `--project` filter, TUI active filter summary.
- Revisit when: GUI 통합에서 프로젝트 grouping의 primary navigation UX를 설계할 때.

### R2: local-only hook session index

- Status: confirmed
- Requirement: Codex lifecycle hook payload를 Codex turn을 오래 막지 않고 수집하고, 로컬 세션을 `session_id`, `cwd`, project name, latest event, status, transcript path, model, permission mode, latest assistant summary 기준의 최신 상태 index로 유지해야 한다.
- Rationale: Codex App과 VS Code extension에서 생성한 thread는 client surface와 UX가 다르므로, private client 내부 구현에 결합하지 않고 thread visibility 문제를 해결하려면 공통으로 관측 가능한 Codex lifecycle hook metadata를 빠르게 local state로 변환해야 한다.
- Failure prevented: hook path 지연, session 상태 손실, IDE 내부 구현 변경에 따른 monitor 파손.
- Derived specs/tests: `codex-radar hook`, latest-state `sessions.json`, hook event normalization/cache update tests, `codex-radar prune`, server-side `retention_days` config.
- Assumptions: 대상 client surface가 local Codex lifecycle hook을 발생시킨다. hook은 공통 관측면이지만 authoritative session API는 아니므로, status는 마지막으로 관측한 event와 그로부터의 추론으로 취급한다.
- Revisit when: Codex hook payload contract, session identifier model, 또는 App/extension을 가로지르는 안정적인 공통 session API가 제공될 때.

### R3: terminal MVP/fallback workflow

- Status: confirmed
- Requirement: GUI 통합 전까지 terminal-first workflow로 세션 목록, transcript skim, TUI dashboard, done/waiting approval foreground watch를 사용할 수 있어야 한다.
- Rationale: 최종 GUI 통합을 기다리지 않고 원격 개발 환경의 visibility 문제를 먼저 줄여야 한다.
- Failure prevented: GUI/extension 구현에 막혀 실제 thread 확인과 switching 개선이 지연되는 문제.
- Derived specs/tests: `sessions`, `transcript`, `tui`, `watch` default done alerts, optional waiting approval alerts, `completion`, CLI/TUI/watch/completion tests.
- Revisit when: GUI 통합이 terminal MVP의 주요 workflow를 대체할 만큼 안정화될 때.

### R4: status-based attention routing

- Status: confirmed
- Requirement: thread 상태는 `active`, `running`, `tool_running`, `waiting_approval`, `done`, `stale`처럼 사용자의 주의가 필요한 정도를 구분할 수 있게 표현되어야 한다.
- Rationale: 사용자는 어떤 thread가 기다리는지, 완료됐는지, 멈춘 듯한지 빠르게 판단해야 한다.
- Failure prevented: turn 종료, approval request, tool 상태 변화를 놓치는 문제.
- Derived specs/tests: event-to-status mapping, display-only `stale`, done/waiting approval watcher, stale/session filter tests.
- Revisit when: Codex lifecycle event 종류나 user attention model이 바뀔 때.

### R5: safe transcript skim

- Status: confirmed
- Requirement: 사용자가 전체 transcript를 열지 않고도 최근 맥락을 훑을 수 있어야 하며, transcript skim output은 secret-like token과 home path를 best-effort로 redact해야 한다.
- Rationale: 최근 context 확인 비용을 줄이되 transcript와 hook payload가 민감한 로컬 데이터라는 전제를 유지해야 한다.
- Failure prevented: 최근 context를 확인하려고 매번 전체 transcript를 열거나, skim 과정에서 민감 정보가 부주의하게 노출되는 문제.
- Derived specs/tests: `codex-radar transcript`, TUI preview, VS Code redacted cached snippet display, explicit VS Code editor preview, transcript redaction tests.
- Revisit when: transcript format이나 redaction threat model이 바뀔 때.

### R6: privacy and automation boundary

- Status: confirmed
- Requirement: `codex-radar`는 로컬 상태 쓰기와 명시적 local read만 수행하며, 전역 Codex config 자동 수정, 외부 전송, transcript 삭제, 관찰한 repository 수정은 하지 않아야 한다.
- Rationale: transcript, hook payload, private path, prompt, code, secret은 민감한 로컬 데이터로 취급해야 한다.
- Failure prevented: private data 유출, 전역 Codex 설정 손상, 관찰 도구가 작업 repository를 변경하는 문제.
- Derived specs/tests: local state directory, runbook-only hook install, minimal watcher alert, no default raw event log, retention pruning, privacy/automation boundary docs.
- Revisit when: notification, GUI integration, external sync, automation surface를 도입할 때.

### R7: staged GUI integration

- Status: confirmed direction, sectioned Webview sidebar/dashboard active
- Requirement: 장기적으로는 VS Code extension 같은 GUI surface에서 프로젝트 단위로 묶인 conversation list와 thread 상태/알림을 통합해야 한다.
- Rationale: 최종 사용 표면은 remote VS Code workflow 안에 자연스럽게 들어가야 하며, terminal MVP는 fallback이다.
- Failure prevented: terminal watcher를 계속 켜두어야만 thread 상태를 알 수 있는 운영 부담.
- Assumptions: GUI 통합은 local state와 privacy boundary를 유지하는 방식으로 설계할 수 있다.
- Derived specs/tests: planned GUI read contract v1, project-grouped Webview sidebar sections, in-surface attention cues, editor Webview dashboard, editor session preview, extension-local read/unread state, 원천 세션 캐시 기준으로 제한되는 파생 UI 상태, read-only cache-change refresh, GUI status filter, dashboard without retention/prune controls, first milestone action boundary, extension surface boundary, optional app-server thread title/archive catalog, `extensions/vscode` scaffold and SessionSource/dashboard view model tests.
- Revisit when: GUI read contract가 복잡해지거나, computed field/redaction/display policy가 늘어나거나, VS Code extension implementation milestone을 시작할 때.

#### R7a: GUI project navigation

- Status: confirmed direction
- Requirement: GUI는 프로젝트 단위로 묶인 conversation list를 primary navigation으로 제공해야 한다.
- Rationale: VS Code용 Codex extension의 기본 대화 목록은 프로젝트별 switching에 충분하지 않으므로, GUI 통합의 첫 가치는 project grouping이다.
- Failure prevented: terminal fallback을 열지 않으면 프로젝트별 Codex thread를 찾기 어려운 문제.
- Derived specs/tests: GUI project grouping rules, sidebar project folding rules, direct `sessions.json` read contract v1, `extensions/vscode` SessionSource grouping tests, Webview sidebar project section tests, Webview dashboard project grouping tests.

#### R7b: GUI attention state

- Status: confirmed direction
- Requirement: GUI는 `waiting_approval`, `running`, `tool_running`, `done`, `unknown` 같은 thread 상태를 navigation 안에서 구분하고, attention badge는 `waiting_approval`과 unread `done`처럼 사용자 확인이 필요한 상태를 표현해야 한다. Codex archived session은 active navigation에서 분리되어야 한다.
- Rationale: 사용자는 VS Code workflow 안에서 어떤 thread가 주의가 필요한지 확인해야 하지만, OS/external notification은 content template과 redaction policy 없이는 scope가 커진다.
- Failure prevented: thread 상태를 놓치거나, 초기 GUI milestone이 OS/external notification 설계로 과도하게 확장되는 문제.
- Derived specs/tests: GUI notification rules, in-surface cue only, Radar-native status bar attention/running counts, extension-local read/unread toggle, 원천 세션 캐시에 더 이상 없는 session의 read state 정리, Webview sidebar attention badge, Webview attention counts, archived section routing, no OS/external notification before explicit opt-in milestone.

#### R7c: GUI privacy boundary

- Status: confirmed direction
- Requirement: GUI는 host-local `codex-radar` state를 읽되 transcript/session metadata를 외부로 전송하지 않고, raw hook event log나 raw transcript는 기본 navigation에서 직접 노출하지 않아야 한다.
- Rationale: GUI는 편의 표면일 뿐 privacy boundary를 완화하지 않아야 한다.
- Failure prevented: GUI 통합 과정에서 transcript path, prompt, code, secret-like content가 부주의하게 표시되거나 외부로 전송되는 문제.
- Derived specs/tests: sensitive field display rules, redacted transcript-derived title/snippet in default navigation, app-server thread title exact-id enrichment, no raw transcript path/content in default navigation, best-effort redaction reuse.

#### R7d: GUI fallback continuity

- Status: confirmed direction
- Requirement: GUI가 안정화될 때까지 terminal MVP와 foreground watcher는 fallback workflow로 유지되어야 한다.
- Rationale: GUI integration은 최종 표면이지만, 원격 환경에서는 terminal fallback이 초기 운영 안정성을 제공한다.
- Failure prevented: GUI 구현 중 terminal workflow를 잃어 실제 thread visibility가 퇴보하는 문제.
- Derived specs/tests: terminal MVP remains supported while GUI integration is experimental.

#### R7e: workspace-aware thread resume

- Status: confirmed direction, workspace-aware VS Code handoff active
- Requirement: 다른 workspace의 Codex thread를 GUI에서 재개할 때는 session working directory를 자동으로 무시하지 않고, 해당 directory를 포함하는 workspace에서 열지 현재 window에서 열지 사용자가 통제할 수 있어야 한다.
- Rationale: thread identity만 전달해 unrelated workspace의 Codex에서 재개하면 대화는 맞아도 file context가 달라 실제 후속 작업의 안전성과 효율이 떨어진다.
- Failure prevented: 사용자가 다른 repository가 열린 window에서 thread를 재개한 뒤 잘못된 file context를 기준으로 조사하거나 수정하는 문제.
- Assumptions: current session cache의 `cwd`는 thread가 사용한 working directory를 나타내지만, 과거 saved `.code-workspace` 또는 multi-root workspace identity까지 복원하지는 않는다.
- Derived specs/tests: current-workspace path containment check, mismatch modal, `ask`/`openWorkspace`/`openHere` setting, destination-workspace and focused-window-gated one-shot handoff, Remote SSH URI authority preservation, missing/unavailable cwd fallback.

### R8: host-local Codex usage visibility

- Status: confirmed direction, experimental rollout-log adapter active
- Requirement: VS Code extension host에서 접근 가능한 host-local Codex session rollout state를 read-only로 관찰해, 해당 VS Code window가 붙어 있는 실행 환경의 Codex rate-limit 사용률과 reset 시각을 빠르게 볼 수 있어야 한다.
- Rationale: 원격 또는 로컬 개발 환경에서 Codex를 여러 thread/작업에 쓰는 경우, 사용량 한계에 가까운지 모르면 긴 작업이나 병렬 작업을 시작했다가 중단/지연될 수 있다.
- Failure prevented: extension host의 Codex 사용량 상태를 모른 채 새 Codex 작업을 시작하는 문제.
- Assumptions: Codex가 같은 extension host의 `CODEX_HOME` 또는 `~/.codex` 아래 `sessions/rollout-*.jsonl`에 `token_count`/`rate_limits` event를 남긴다. 이 rollout JSONL shape는 공식 stable API가 아니므로 experimental adapter로 취급한다.
- Non-goals: local UI client machine의 별도 Codex state 읽기, `auth.json` 읽기, 서버 요청, 공식 Codex config/hook 수정, raw rollout line 저장.
- Derived specs/tests: `codex-radar usage --json`, host-local VS Code status bar usage snapshot, `window_minutes`-based 5h/7d semantic pool placement, absent-pool placeholder, null/unavailable fallback, broken JSONL skip, latest `token_count` selection, raw path/content exclusion.
- Revisit when: Codex가 공식 local usage API/export/status endpoint를 제공하거나 rollout schema가 사라질 때.

### R9: foreground mobile cockpit over SSH

- Status: proposed direction
- Requirement: 장기 모바일 surface는 별도 remote HTTP server를 먼저 열기보다 Android app이 SSH 연결 위에서 host-local `codex-radar` machine-readable protocol을 실행해 프로젝트별 thread list, 상태, bounded transcript preview, foreground attention event를 받아볼 수 있어야 한다.
- Rationale: 모바일에서의 주요 문제는 공식 ChatGPT app의 project/thread switching depth와 멀티태스킹 제약이다. 사용자가 앱을 열고 여러 프로젝트의 Codex thread를 집중적으로 전환하는 상황에서는 SSH trust boundary와 host-local sanitized model을 재사용하는 편이 server auth, port exposure, push infrastructure보다 단순하다.
- Failure prevented: 모바일 UX를 위해 별도 server/auth/push stack을 먼저 설계하면서 scope가 커지거나, 반대로 CLI/TUI를 사람용 terminal UI로만 키워 Android/PWA가 재사용할 안정된 contract가 없는 문제.
- Assumptions: 초기 모바일 앱은 foreground-first tool이다. 앱이 닫혔거나 SSH/RPC 연결이 끊긴 동안의 notification delivery는 보장하지 않으며, 장기 push notification은 공식 ChatGPT/Codex app 또는 별도 milestone의 역할로 둔다.
- Derived specs/tests: future `codex-radar rpc` or equivalent JSON/JSONL protocol, shared mobile/gui state builder, strict stdout protocol with diagnostics on stderr, bounded/redacted preview output, foreground in-app attention events, no remote HTTP listener by default.
- Revisit when: Android app, mobile web/PWA, background notification, multi-host dashboard, or remote write actions become active milestones.

### R10: surface-independent local runtime

- Status: candidate direction
- Requirement: Codex lifecycle 상태 수집과 latest-state cache/protocol 생성은 VS Code extension 같은 특정 UI client가 아니라 host-local `codex-radar` runtime/indexer가 담당해야 한다.
- Rationale: VS Code extension, future Android app, TUI, CLI fallback이 같은 lifecycle-derived state와 privacy boundary를 재사용해야 한다. UI client별로 Codex transcript, rollout log, state DB 같은 내부 파일을 각자 scan해 상태를 추론하면 attention 상태의 의미와 정확도가 표면마다 갈라질 수 있다.
- Failure prevented: extension-only scan에 의존해 `waiting_approval`, `tool_running`, `done` 같은 attention 상태를 놓치거나 다르게 해석하는 문제. VS Code extension에 indexer ownership이 묶여 future app surface가 별도 관측 로직을 재구현하는 문제.
- Assumptions: Codex lifecycle hook 또는 그에 준하는 host-local lifecycle event surface가 계속 제공된다. UI client는 local runtime이 만든 sanitized state/protocol을 읽을 수 있다.
- Derived specs/tests: current `codex-radar hook` producer and `sessions.json` cache, GUI `SessionSource` read adapter, future shared GUI/mobile state builder, future `codex-radar rpc`, setup diagnostics for missing or outdated runtime/indexer, stable hook entrypoint with explicit migration when hook wiring changes.
- Revisit when: Codex가 공식 stable cross-client session/status API를 제공하거나, lifecycle hook 없이도 `waiting_approval`/`tool_running`/`done` 상태를 안정적으로 제공하는 supported local API가 생길 때.

#### R10a: stable hook entrypoint and migration boundary

- Status: candidate direction
- Requirement: 배포 가능한 hook integration은 가능한 한 stable command/shim을 `hooks.json`에 등록하고, helper/indexer implementation 업데이트는 hook config 변경 없이 처리해야 한다. hook event set, command contract, privacy boundary가 바뀌는 경우에만 사용자 승인 기반 migration을 요구해야 한다.
- Rationale: extension, CLI, future app 배포가 반복되어도 global Codex hook config churn을 줄이고, 사용자가 승인하지 않은 Codex config 변경을 피해야 한다.
- Failure prevented: extension update마다 hook path가 깨지는 문제, outdated hook wiring이 조용히 남아 세션 index가 비는 문제, global Codex config가 자동으로 변경되는 privacy/automation boundary 위반.
- Derived specs/tests: setup/doctor detects missing or outdated hook runtime, hook migration preview/diff before write, uninstall or disable path for stable shim, no automatic `~/.codex/hooks.json` edits outside explicit setup/migration flow.

## Rationale

VS Code Remote SSH로 원격 환경에서 개발하면서 remote environment 안의 Codex를 함께 사용하는 경우, VS Code용 Codex extension의 대화 목록은 Codex App처럼 프로젝트 단위로 구분되어 보이지 않아 repository별 thread 전환이 어렵고, thread 알림과 상태 가시성만으로는 어떤 thread가 대기/완료/승인요청 상태인지 놓치기 쉽다. Codex App과 VS Code extension은 client surface가 다르므로, client별 내부 저장소나 UI 구조를 직접 읽는 방식은 공통 감시 방법으로 안정적이지 않다. Codex hook은 이미 session과 transcript metadata를 노출하는 host-local lifecycle 관측면이므로, private client 내부 구현에 의존하지 않고 host-local 인덱서로 visibility 문제를 먼저 해결할 수 있다.

## Failure Prevented

- 어느 Codex 대화가 어느 repository 작업인지 잃어버리는 문제.
- VS Code 안의 Codex 대화 목록에서 프로젝트별 thread를 찾거나 전환하기 어려운 문제.
- turn 종료, approval request, tool 상태 변화를 놓치는 문제.
- 원격 개발 중 VS Code 안에서 확인해야 할 Codex thread 상태를 놓치는 문제.
- 최근 context를 확인하려고 매번 전체 transcript를 여는 문제.
- 불안정한 VS Code extension 내부 구현에 monitoring을 결합하는 문제.
