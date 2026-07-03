# codex-radar Spec

## Root Goal

`codex-radar`는 로컬 Codex 대화가 어느 프로젝트에 속하는지, 현재 어떤 상태인지, 최근 transcript를 열어볼 가치가 있는지를 빠르게 확인하게 해준다.

## Requirements

- Codex lifecycle hook payload를 Codex turn을 오래 막지 않고 수집한다.
- 로컬 세션을 `session_id`, `cwd`, project name, latest event, status, transcript path, model, permission mode, latest assistant summary 기준으로 인덱싱한다.
- terminal-first workflow를 제공한다.
  - `codex-radar hook`: stdin에서 hook payload 1개를 읽어 기록한다.
  - `codex-radar sessions`: 알려진 세션 목록을 출력한다.
  - `codex-radar transcript <session-or-path>`: 로컬 transcript를 짧게 훑어본다.
  - `codex-radar tui`: 가벼운 session dashboard를 연다.
- TUI는 선택한 session의 metadata와 transcript preview를 같은 terminal 안에서 보여준다.
- TUI에서 resumable session row를 선택하고 Enter를 누르면 curses UI를 종료한 뒤 같은 terminal에서 `codex resume <session_id>`를 실행한다.
- session id가 없거나 placeholder unknown id인 row는 resume disabled 상태로 표시하고 Enter resume을 수행하지 않는다.
- 전역 Codex config를 자동 수정하지 않는다.
- 로컬 transcript 내용이나 runtime state를 commit하거나 업로드하지 않는다.

## Rationale

Codex IDE extension에서는 여러 프로젝트의 대화가 동시에 열릴 수 있지만, 어떤 대화가 어느 repository에 속하는지와 완료/대기 상태를 한눈에 보기 어렵다. Codex hook은 이미 session과 transcript metadata를 노출하므로, private IDE 내부 구현에 의존하지 않고 로컬 인덱서로 visibility 문제를 해결할 수 있다.

## Failure Prevented

- 어느 Codex 대화가 어느 repository 작업인지 잃어버리는 문제.
- turn 종료, approval request, tool 상태 변화를 놓치는 문제.
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

## Privacy Boundary

Transcript와 hook payload에는 private path, prompt, code, command output, secret이 포함될 수 있다. `codex-radar`는 이를 민감한 로컬 데이터로 취급한다.

Transcript skim output은 흔한 secret-like token을 best-effort로 redact하지만, 이것은 security boundary가 아니다.

## Non-goals

- 초기 버전에서는 IDE extension integration을 만들지 않는다.
- cloud sync 없음.
- live token streaming 없음.
- Codex native transcript viewer를 대체하지 않음.
- 별도 requirement로 channel, content, privacy rule이 정해지기 전까지 notification delivery 없음.
