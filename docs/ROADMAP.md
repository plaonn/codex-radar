# codex-radar Roadmap

## Roadmap Operating Model

이 문서는 구현 완료 로그가 아니라 다음 product/runtime milestone의 admission boundary를 정의한다. 현재 동작과 계약은 [SPEC.md](SPEC.md), requirement와 rationale은 [REQUIREMENTS.md](REQUIREMENTS.md)를 따른다.

Milestone status:

- `operating`: 현재 구현과 지원 범위에 반영됐으며 regression과 운영 안정성을 계속 관리한다.
- `active`: 현재 release 또는 구현 묶음으로 구체화돼 실행 task를 둘 수 있다.
- `watching`: exit criterion은 명확하지만 external environment, upstream contract, 또는 별도 승인 때문에 즉시 완료할 수 없다.
- `trigger-based`: 시작 조건이 충족될 때만 proposal 또는 spike를 task로 승격한다.
- `parking`: 가능성만 보존하며 trigger와 첫 검토 산출물이 정해지기 전에는 실행 task를 만들지 않는다.

Task admission rules:

- Roadmap milestone은 방향, entry condition, exit criterion, decision boundary를 보존한다.
- Active task dashboard에는 한 root thread가 전담할 수 있고 지금 실행하거나 관찰할 수 있는 work package만 둔다.
- `trigger-based`와 `parking` 항목은 trigger가 충족되기 전에는 task로 복제하지 않는다.
- Candidate preparation, passing CI, local smoke, queue receipt는 publication, external smoke, support-complete 선언과 구분한다.

## Milestone Map

| ID | Milestone | Status | Next admission boundary |
|---|---|---|---|
| M1 | Shared host-local runtime and VS Code cockpit | operating | Current contract regression or setup reliability evidence |
| M2 | Next public-beta consolidation | active | Select one VSIX/helper candidate pair and close candidate checks |
| M3 | Native Windows real-host validation | watching | Deliver a compatible helper bundle to the Windows host and run the bounded smoke |
| M4 | Mobile SSH read-protocol Stage 0 | trigger-based | Admit a protocol spike after M2 and display-state/preview contract stability review |
| M5 | Distribution channel expansion | trigger-based | A concrete install/update problem justifies one channel proposal |
| M6 | Notification expansion | trigger-based | A foreground cockpit cannot satisfy an evidenced attention use case |
| M7 | Experimental foreground thread orchestration | operating | A real client requires broader lifecycle or write capability |

## M1: Shared Host-Local Runtime and VS Code Cockpit

- Status: `operating`.
- Scope: host-local Python lifecycle producer, latest-state `sessions.json`, sanitized display-state and bounded preview contracts, terminal fallback, and read-oriented VS Code sidebar/dashboard/preview surfaces.
- Operating invariant: lifecycle truth remains producer-owned; clients preserve the local privacy boundary and do not silently mutate global Codex config.
- Exit from operating status: none. Replacement requires a supported cross-client lifecycle source with parity evidence and an explicit migration milestone.

## M2: Next Public-Beta Consolidation

- Status: `active` for candidate definition and validation; publication remains a separate approval.
- Entry condition: source versions or user-visible changes have advanced beyond the last documented public release and form one reviewable compatibility set.
- Work package:
  - select the VSIX/helper candidate pair from current source versions;
  - reconcile changelog, bilingual release notes, compatibility manifest, and generated artifact names;
  - run Python tests/compileall, VS Code extension tests/package, manifest inspection, and POSIX or Remote SSH install/upgrade smoke proportional to the changed surface;
  - state explicitly whether Native Windows assets are excluded, candidate-only, or independently validated.
- Exit criterion: one candidate pair and evidence bundle are internally consistent and pushed. GitHub Release or other publication is not part of this exit criterion.
- Decision boundary: Codex may choose the candidate composition from repository evidence. Any public release, support-level expansion, Marketplace/PyPI publication, or credential/account action requires separate user approval.

## M3: Native Windows Real-Host Validation

- Status: `watching`; platform/helper foundation and CI exist, but the real-host proof is incomplete.
- Entry condition: a compatible generated helper bundle is available on the separate Native Windows host and the user explicitly starts the documented hook migration/smoke flow.
- Exit criterion: an actual Codex lifecycle hook updates `%LOCALAPPDATA%\codex-radar\state\sessions.json`, and the VS Code sidebar on the same host shows that exact session without treating WSL2 or CI as substitute evidence.
- Decision boundary: helper delivery and smoke are bounded external actions. Release publication, automatic `hooks.json` edits, private transcript/path sharing, and support-complete claims remain outside this milestone.

## M4: Mobile SSH Read-Protocol Stage 0

- Status: `trigger-based`; R9 remains a proposed product direction, not an active Android implementation milestone.
- Entry condition: M2 candidate work is closed and shared display-state/preview contracts have no unresolved migration or privacy defect that would be frozen into a remote protocol.
- First work package: a read-only protocol proposal plus host-local spike that proves version negotiation, project/thread list, bounded redacted preview, foreground attention events, stdout/stderr separation, disconnect/reconnect behavior, and SSH trust-boundary assumptions.
- Exit criterion: golden fixtures and a local SSH-loopback or equivalent harness demonstrate the protocol without opening a network listener or adding remote write actions.
- Non-goals: production Android UI, background push, multi-host aggregation, shared read state, and unifying this read protocol with experimental R12 write orchestration without a separate design decision.
- Decision boundary: Codex may design and evaluate Stage 0. Activating an Android product phase or choosing a mobile UX/support commitment is a user-owned product-priority decision.

## M5: Distribution Channel Expansion

- Status: `trigger-based`; GitHub Release assets remain the public-beta distribution path described by current public docs.
- Admission rule: create one proposal per channel rather than a combined distribution rewrite.
  - Marketplace: trigger on demonstrated VSIX discovery/update friction; proposal must cover publisher/namespace ownership, metadata/assets, release automation, rollback, and support policy.
  - PyPI: trigger on demonstrated helper install/update friction that the verified bundle flow cannot reasonably solve; proposal must preserve stable hook entrypoint and compatibility metadata.
  - Signed installer or package manager: trigger on Native Windows validation completion plus repeated privilege, trust, or upgrade friction; proposal must define signing/account ownership and rollback.
- Exit criterion: the selected channel has an approved operating model and a separately authorized publication task. Proposal completion never implies publication.

## M6: Notification Expansion

- Status: `trigger-based`.
- Entry condition: in-surface VS Code cues or foreground mobile attention events fail an evidenced workflow that matters while the relevant client is not visible.
- First work package: proposal defining explicit opt-in, event eligibility, content template, redaction, quiet/failure behavior, and delivery ownership.
- Exit criterion: requirement and privacy boundary are approved before any OS or external notification implementation begins.
- Non-goals until then: default notifications, transcript content in notifications, and external delivery channels.

## M7: Experimental Foreground Thread Orchestration

- Status: `operating` as an explicit foreground experiment; it is not a general GUI write surface or background service.
- Scope: R12 `codex-radar thread rpc` and one-shot foreground thread commands over one user-owned compatible Codex app-server connection.
- Operating invariant: no network listener, daemon bootstrap, automatic approval, existing client tool-inventory mutation, or replacement of the hook-owned lifecycle index.
- Next entry condition: a concrete VS Code, Android/SSH, or CLI client requires lifecycle ownership or write capability beyond the current bounded dynamic tools, and the supported app-server contract can express it.
- Exit criterion for expansion: a separate requirement defines ownership, approval, recursion/output bounds, failure recovery, and client-visible consent before implementation. Upstream contract observation alone does not activate new writes.

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
- GUI implementation은 read adapter를 통해 state source를 캡슐화한다. Schema evolution, computed field, archive/usage normalization, transcript redaction policy가 이미 여러 surface에서 중복되기 시작했으므로 shared sanitized export contract로 전환하는 조건은 충족된 것으로 본다.
- GUI는 thread 상태(`waiting_approval`, `running`, `tool_running`, `done`, `unknown`)와 Codex archived state를 navigation 안에서 구분해야 한다.
- 첫 GUI notification surface는 sidebar section badge와 dashboard count/highlight 같은 in-surface cue로 제한한다.
- GUI의 Codex/codex-radar runtime state는 read-only로 유지한다. Extension-local read/unread UI state와 사용자가 명시적으로 실행하는 user-visible integrated-terminal `codex resume` action은 active scope다. VS Code GUI에서는 retention config/prune controls를 노출하지 않고 terminal CLI workflow에 맡긴다.
- GUI integration은 transcript/session metadata를 외부로 전송하지 않고 R6 privacy boundary를 유지해야 한다.
- Shared export를 GUI list의 기본 source로 사용하고, command/source/schema failure에는 direct `sessions.json` adapter로 fallback한다. Raw host-local action metadata는 sanitized contract 밖의 trusted adapter boundary에 유지한다.

## VS Code Extension Release

- Repository public installation docs가 가리키는 published baseline은 `0.4.4` public beta다. Source versions와 candidate notes가 그 이후로 전진할 수 있으므로 다음 배포 단위는 M2에서 명시적으로 묶는다. Source tree에는 Native Windows helper foundation과 `windows-latest` CI가 추가됐지만, 실제 Windows Codex hook smoke 전에는 Windows support-complete 또는 Windows public release로 선언하지 않는다.
- GitHub Release readiness와 Marketplace publish는 별도 milestone로 유지한다.
- Public beta release readiness에는 version policy, README/install guide, extension icon/branding, privacy boundary copy, changelog, packaged VSIX, Remote SSH install smoke test를 포함한다.
- GitHub Release 기반 설치와 upgrade 경로를 public beta 동안 먼저 안정화한다.
- Marketplace publish는 publisher/namespace, marketplace metadata, asset policy, release 운영 방식이 정해진 뒤 별도 milestone으로 진행한다.

## Local Runtime / Distribution Direction

- 현재 안정 경로는 host-local Python indexer/runtime과 client surface의 분리다. 별도 process app-server는 다른 CLI/App/VS Code client의 live lifecycle을 복원하지 못하므로 Python producer를 lifecycle source of truth로 유지한다. Codex App Server Controller는 supported auxiliary read surface를 단계적으로 맡는다.
- Codex App Server Controller는 사용자가 별도로 설치한 compatible Codex CLI를 실행한다. Radar VSIX는 Codex binary나 별도 app-server implementation을 번들하지 않고, official Codex extension의 private bundled runtime path에도 의존하지 않는다.
- Controller foundation은 long-lived stdio lifecycle과 read-only `thread/list`, diagnostics/reconnect를 제공한다. Cross-process lifecycle parity는 실패했으며, supported `account/rateLimits/read` usage adapter가 rollout fallback/parity observation과 함께 다음 auxiliary read surface로 추가됐다. Transcript preview는 completed stored thread에 한해 별도 migration 후보로 남긴다. `turn/start`, message send, archive/name update 같은 write action은 별도 opt-in requirement와 사용자 승인 전까지 금지한다.
- Direct stdio controller는 정상 VS Code shutdown과 extension reload에서 owned app-server를 정리하지만, extension host가 deactivation 없이 종료되면 child가 남을 수 있다. Ownership을 증명할 수 없는 PPID/process-name sweep, `detached` 전환, undocumented daemon/proxy bootstrap은 해결책으로 채택하지 않는다.
- App-server daemon/proxy adoption은 parked 상태다. Public contract가 macOS/Linux/Windows support, per-user socket path와 ACL/auth, local/Remote SSH ownership, parent/crash/stale cleanup, CLI/daemon/proxy version compatibility, global config/auth 변경 없는 opt-in setup을 명시할 때만 다시 검토한다. 재검토하더라도 첫 단계는 read-only opt-in adapter와 direct-stdio fallback으로 제한한다.
- R12의 experimental thread RPC는 이 금지를 일반 GUI action으로 해제하지 않는다. 사용자가 foreground stdio host를 명시적으로 실행한 경우에만 Radar-owned thread에 `turn/start`와 네 bounded dynamic thread tool을 제공한다. Background daemon, network listener, 자동 approval, 기존 client thread의 tool inventory 수정은 후속 milestone이다.
- Extension-only scan mode는 설치가 단순하더라도 `waiting_approval`, `tool_running`, `done` 같은 lifecycle-derived attention state의 source of truth가 약해지므로 primary architecture로 두지 않는다. 필요하면 lightweight history/preview fallback으로만 검토한다.
- Native Windows foundation은 Python helper, `%LOCALAPPDATA%` defaults, `.cmd` stable shim, immutable version runtime, atomic JSON selector를 사용한다. Signed installer나 package-manager integration은 후속 distribution choice다.
- Hook integration은 stable entrypoint/shim을 지향한다. Helper implementation 업데이트는 가능한 한 hook config 변경 없이 처리하고, event wiring이나 command contract 변경처럼 `hooks.json` migration이 필요한 경우에는 diff/preview와 사용자 승인을 요구한다.
- Setup UX는 extension 하나를 설치한 사용자가 빈 dashboard만 보지 않도록 missing/outdated indexer, missing hook wiring, inaccessible state directory를 명확히 진단하는 방향으로 발전시킨다.
- Public-beta helper의 첫 supported distribution은 GitHub Release의 POSIX helper bundle이다. Native Windows helper bundle publication은 실제 Windows Codex hook smoke와 generated asset 검증 뒤 별도 release decision으로 둔다. PyPI는 계속 별도 milestone이다.
- 첫 supported scope는 POSIX Python 3.9+ host와 VS Code Remote SSH다. Bundle은 checksum manifest를 제공하고 immutable version runtime, atomic `current` switch, retained previous runtime을 사용해 upgrade와 rollback을 분리한다.
- `hooks.json`에는 checkout이나 shell `PATH`에 의존하지 않는 fixed absolute shim(기본 예: `~/.local/bin/codex-radar-hook`)을 등록한다. Shim은 current runtime의 dedicated hook entrypoint로 연결하고 helper upgrade만으로 hook config를 다시 쓰지 않는다.
- Installer/manager는 필요한 `hooks.json` fragment 또는 diff를 출력할 수 있지만 global Codex config를 자동 수정하지 않는다. 기존 `codex-radar hook` entrypoint는 migration을 위해 최소 한 public-beta release 동안 호환 경로로 유지한다.
- VSIX version과 helper/runtime version은 독립적으로 움직일 수 있으므로 release asset에는 명시적인 compatibility manifest를 포함한다.
- WSL2는 Native Windows foundation의 대체 smoke surface가 아니며 이번 공식 검증 범위에서 제외한다.

## Native Windows Validation Gate

- `windows-latest` CI에서 Python unit tests, compileall, extension tests, Windows path/locking/`.cmd` launcher/install/upgrade/rollback lifecycle을 검증한다.
- 실제 Native Windows 사용자 환경에서 Codex가 generated hook command를 실행하고 `%LOCALAPPDATA%\codex-radar\state\sessions.json`을 갱신하며 VS Code sidebar가 같은 session을 표시하는 end-to-end smoke가 남아 있다.
- 이 smoke가 끝나기 전에는 foundation/CI-ready로만 보고하고 Windows 지원 완료, release-ready, officially validated라고 표현하지 않는다.
- WSL2 smoke는 별도 future work이며 Native Windows smoke를 대체하지 않는다.

## Shared State / Export Direction

- Python core에 side-effect-free sanitized display-state builder를 먼저 만들고, 같은 builder를 호출하는 `codex-radar export state --json`을 첫 machine-readable surface로 둔다. RPC/server는 이 contract가 안정화된 뒤의 transport로 취급한다.
- 기본 display-state contract와 transcript preview contract를 분리한다. Preview는 사용자가 session을 명시하고 limit을 지정한 bounded request에서만 생성한다.
- Display state는 source status/capability, aggregate counts, sanitized session fields, semantic usage pools를 포함할 수 있다. Raw `cwd`, private file path, raw transcript/rollout payload, HTML, UI 문자열과 ordering, client-local read/unread state는 포함하지 않는다.
- Archive state는 `active`, `archived`, `unknown` tri-state로 표현한다. v1 read/unread는 각 client의 local UI state로 유지한다.
- Shared export default-source 전환 뒤에도 direct `sessions.json` reader는 export failure fallback과 trusted host-local `cwd`/transcript metadata 결합에 필요하므로 유지한다. Node-side scanner 제거는 workspace handoff, explicit preview, fallback 책임을 shared contract를 오염시키지 않고 대체하는 별도 설계가 생길 때만 진행한다.
- Existing VS Code workspace handoff가 사용하는 raw `cwd`는 trusted host-local adapter에 남긴다. Future mobile/SSH protocol에서 raw path 기반 action이 필요해지면 별도 privacy/product decision을 요구한다.

## Mobile Direction

- 모바일의 장기 surface는 Android app이지만, 초기 bridge는 별도 remote HTTP server보다 SSH 위의 machine-readable `codex-radar` protocol을 우선 검토한다.
- 모바일 앱의 primary use case는 사용자가 앱을 열고 여러 프로젝트의 Codex thread를 집중적으로 훑고 전환하는 foreground cockpit이다.
- 앱이 닫혔거나 SSH 연결이 끊긴 동안 notification delivery를 보장하는 것은 초기 목표가 아니다. 그런 알림은 공식 ChatGPT/Codex app 또는 별도 push notification milestone의 역할로 둔다.
- 모바일 앱은 SSH session에서 `codex-radar rpc` 같은 전용 process를 실행하고 newline-delimited JSON request/response/event를 주고받는 구조를 선호한다. 이 방식은 shell quoting 문제를 줄이고 stdout을 protocol 전용으로 유지할 수 있다.
- RPC contract는 shared display-state/preview builder를 감싸는 transport로 제한하고, project/thread list, status/attention/running/done/archive counts, bounded redacted preview, foreground attention event를 우선한다. Shared read state나 remote write action은 v1 범위에 넣지 않는다.
- Foreground attention event는 사용자가 다른 thread를 보고 있을 때 `done`, `waiting_approval`, `running -> done` 같은 변화를 in-app banner/toast로 보여주고, tap하면 해당 thread로 이동하게 한다.
- TUI는 모바일의 primary path가 아니라 VS Code도 Android app도 없는 SSH-only 환경을 위한 lightweight fallback dashboard로 유지한다.
- Shared state builder는 VS Code extension, TUI fallback, future mobile RPC가 같은 sanitized display model과 privacy boundary를 재사용할 수 있게 설계한다.
- 첫 실행 milestone과 activation boundary는 M4를 따른다. 아래 방향만으로 Android 구현 task를 만들지 않는다.

## Parking Lot

Parking 항목은 아래 trigger가 관찰될 때 먼저 proposal/spike로 승격한다.

- Rich/Textual TUI: SSH-only/headless fallback의 현재 stdlib TUI로 해결할 수 없는 반복 UX 문제가 확인될 때. 첫 산출물은 dependency/packaging 비용을 포함한 비교안이다.
- 과거 `~/.codex/sessions` metadata optional import: current lifecycle index만으로 복원할 수 없는 migration 사례가 확인될 때. 첫 산출물은 identity/privacy compatibility spike다.
- worktree 또는 nested repository용 project alias: current `cwd` classification의 반복 오분류 사례가 수집될 때. 첫 산출물은 alias ownership과 저장 위치 proposal이다.
- command-copy 또는 retention controls: Remote SSH sidebar/dashboard/preview 안정성 evidence가 있고 terminal-only workflow가 반복적인 운영 부담으로 확인될 때. 첫 산출물은 opt-in GUI action boundary proposal이다.
- transcript history expansion: bounded latest preview가 실제 review workflow를 반복적으로 막을 때. 첫 산출물은 `Load older`/lazy loading/full transcript 비교와 scroll anchoring, redaction, DOM/memory budget이다.
- configurable `stale_after_minutes`: 현재 30분 기준이 환경별로 의미 있는 false stale/false active를 만든다는 evidence가 있을 때. 첫 산출물은 config ownership과 surface parity proposal이다.
