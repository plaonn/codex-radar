# codex-radar Spec

## Root Goal

`codex-radar`는 추가 프로그램 설치가 어려운 원격 개발 환경에서 VS Code Remote SSH와 로컬 Codex를 함께 사용할 때, Codex thread를 프로젝트 단위로 구분하고, 대기/완료/승인요청 상태와 확인할 가치가 있는 최근 transcript를 빠르게 파악하게 해준다.

## Requirement

- Codex lifecycle hook payload를 Codex turn을 오래 막지 않고 수집한다.
- 로컬 세션을 `session_id`, `cwd`, project name, latest event, status, transcript path, model, permission mode, latest assistant summary 기준으로 인덱싱한다.
- 대화 목록은 프로젝트 단위로 구분하고, 사용자가 프로젝트 기준으로 thread를 좁혀보거나 전환할 수 있게 한다.
- 초기 MVP와 fallback으로 terminal-first workflow를 제공한다.
  - `codex-radar hook`: stdin에서 hook payload 1개를 읽어 기록한다.
  - `codex-radar sessions`: 알려진 세션 목록을 출력한다.
  - `codex-radar transcript <session-or-path>`: 로컬 transcript를 짧게 훑어본다.
  - `codex-radar tui`: 가벼운 session dashboard를 연다.
  - `codex-radar watch`: foreground watcher를 실행해 새 `waiting_approval` session을 terminal bell과 최소 metadata line으로 알린다.
  - `codex-radar completion <bash|zsh|fish>`: shell completion script를 stdout으로 출력한다.
- TUI는 선택한 session의 metadata와 transcript preview를 같은 terminal 안에서 보여준다.
- TUI에서 resumable session row를 선택하고 Enter를 누르면 curses UI를 종료한 뒤 같은 terminal에서 `codex resume <session_id>`를 실행한다.
- session id가 없거나 placeholder unknown id인 row는 resume disabled 상태로 표시하고 Enter resume을 수행하지 않는다.
- `sessions`와 `tui`는 `active`, `running`, `tool_running` 상태의 session이 30분 넘게 update되지 않으면 cache의 원본 `status`를 바꾸지 않고 display status를 `stale`로 보여준다.
- 전역 Codex config를 자동 수정하지 않는다.
- 로컬 transcript 내용이나 runtime state를 commit하거나 업로드하지 않는다.

## Spec

현재 spec은 local-only hook indexer, append-only event log, derived session cache, project-aware session list/filtering, terminal MVP commands, opt-in foreground watcher, transcript skim, automation/privacy boundary로 구성된다. 장기적으로는 VS Code extension 같은 GUI surface에서 프로젝트 단위로 묶인 conversation list와 통합하는 것을 지향하지만, 현재 spec은 terminal MVP/fallback contract를 정의한다. 구체적인 상태 전이, data field, command behavior, watcher behavior는 아래 섹션의 contract를 따른다.

## Rationale

VS Code Remote SSH로 원격 환경에서 개발하면서 이 PC의 로컬 Codex를 함께 사용하는 경우, VS Code용 Codex extension의 대화 목록은 Codex App처럼 프로젝트 단위로 구분되어 보이지 않아 repository별 thread 전환이 어렵고, thread 알림과 상태 가시성만으로는 어떤 thread가 대기/완료/승인요청 상태인지 놓치기 쉽다. Codex hook은 이미 session과 transcript metadata를 노출하므로, private IDE 내부 구현에 의존하지 않고 로컬 인덱서로 visibility 문제를 먼저 해결할 수 있다.

## Failure Prevented

- 어느 Codex 대화가 어느 repository 작업인지 잃어버리는 문제.
- VS Code 안의 Codex 대화 목록에서 프로젝트별 thread를 찾거나 전환하기 어려운 문제.
- turn 종료, approval request, tool 상태 변화를 놓치는 문제.
- 원격 개발 중 VS Code 안에서 확인해야 할 Codex thread 상태를 놓치는 문제.
- 최근 context를 확인하려고 매번 전체 transcript를 여는 문제.
- 불안정한 VS Code extension 내부 구현에 monitoring을 결합하는 문제.

## Current Architecture

`codex-radar`는 stdlib-first Python CLI다.

```text
Codex hook event
  -> codex-radar hook
  -> events.jsonl append-only log
  -> sessions.json derived latest-state cache
  -> sessions/transcript/tui commands
```

runtime state 기본 위치:

```text
$CODEX_RADAR_HOME
or $XDG_STATE_HOME/codex-radar
or ~/.local/state/codex-radar
```

state directory 구성:

- `events.jsonl`: 정규화된 hook event append-only log.
- `sessions.json`: latest session cache.
- `.lock`: append/cache update 중 사용하는 coarse file lock.

## Data Model

정규화된 event field:

- `recorded_at`: 로컬 capture 시간, UTC ISO-8601.
- `event_name`: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop` 같은 hook event 이름.
- `session_id`
- `turn_id`
- `status`: dashboard용 derived status.
- `cwd`
- `project`: `cwd` basename.
- `transcript_path`
- `model`
- `permission_mode`
- `tool_name`
- `last_assistant_message`
- `raw`: 원본 hook payload.

derived status:

- `active`: session 시작 또는 resume.
- `running`: user turn 진행 중.
- `tool_running`: tool 실행 시작.
- `waiting_approval`: Codex가 permission을 요청함.
- `done`: turn 종료.
- `unknown`: event를 명확히 mapping하지 못함.

display-only status:

- `stale`: cache의 원본 status가 `active`, `running`, `tool_running`이고 `last_seen_at`이 30분보다 오래된 경우. `waiting_approval`과 `done`은 오래되어도 원 status를 유지한다.

`codex-radar sessions` and `codex-radar tui` filters:

- `--project <value>`: `project` exact match.
- `--status <value>`: display status exact match. `stale`도 지정할 수 있다.
- `--model <value>`: `model` exact match.
- `--since <when>`: `last_seen_at`이 기준 시각 이상인 session만 출력한다. `<when>`은 ISO-8601 timestamp 또는 `30m`, `2h`, `7d` 같은 duration이며 duration unit은 seconds/minutes/hours/days를 뜻하는 `s`, `m`, `h`, `d`를 지원한다.

`tui` filter는 dashboard를 열 때 적용되며, TUI title line에 active filter summary를 표시한다.

현재 terminal MVP는 project column과 `--project` filter로 프로젝트 단위 구분과 narrowing을 제공한다. 향후 GUI 통합에서는 프로젝트 단위로 묶인 conversation list가 primary navigation surface가 되어야 한다.

## Automation Boundary

허용:

- stdin에서 hook payload 1개 읽기.
- 설정된 state directory 아래에 로컬 상태 쓰기.
- 사용자가 transcript/TUI command를 실행했을 때 로컬 transcript 파일 읽기.
- 사용자가 TUI에서 resumable row를 선택하고 Enter를 눌렀을 때 같은 terminal process를 `codex resume <session_id>`로 교체하기.

금지:

- `~/.codex/hooks.json` 자동 편집.
- notification, telemetry, transcript, session metadata를 외부 서비스로 전송.
- Codex transcript 삭제.
- `cwd`로 관찰한 repository 수정.

## Foreground Watcher

`codex-radar watch`는 명시적으로 실행했을 때만 동작하는 opt-in local watcher다.

- `sessions.json`을 polling한다.
- 새 `waiting_approval` session만 alert한다.
- alert 내용은 `waiting_approval`, project basename, event name으로 제한한다.
- 기본 alert는 terminal bell과 한 줄 출력이다.
- `--no-bell`을 지정하면 terminal bell 없이 한 줄만 출력한다.
- hook path에서는 notification이나 bell을 직접 보내지 않는다.
- 이 watcher는 terminal에서 직접 켜두는 MVP/fallback 알림 표면이며, 향후 VS Code extension 같은 GUI 통합 요구사항을 대체하지 않는다.

## Privacy Boundary

Transcript와 hook payload에는 private path, prompt, code, command output, secret이 포함될 수 있다. `codex-radar`는 이를 민감한 로컬 데이터로 취급한다.

Transcript skim output은 흔한 secret-like token을 best-effort로 redact하지만, 이것은 security boundary가 아니다.

## Tests / Checks

- `PYTHONPATH=src python3 -m unittest discover`
- `python3 -m compileall src tests`
- 현재 테스트는 hook event normalization/cache update, stale display status, session filters, transcript skim/redaction, TUI resume guard, waiting approval watcher, shell completion을 보호한다.

## Non-goals

- cloud sync 없음.
- live token streaming 없음.
- Codex native transcript viewer를 대체하지 않음.
- OS notification, external notification channel 없음.
