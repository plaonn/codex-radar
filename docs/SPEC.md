# codex-radar Spec

Current requirements and RDD hierarchy live in [REQUIREMENTS.md](REQUIREMENTS.md).
This document defines the current terminal MVP behavior, data model, and local automation/privacy contract.

## Spec

현재 spec은 local-only hook indexer, latest-state session index, server-side retention config/pruning, project-aware session list/filtering, terminal MVP commands, opt-in foreground watcher, transcript skim, automation/privacy boundary로 구성된다. 장기적으로는 VS Code extension 같은 GUI surface에서 프로젝트 단위로 묶인 conversation list와 통합하는 것을 지향하지만, 현재 spec은 terminal MVP/fallback contract를 정의한다. 구체적인 상태 전이, data field, command behavior, watcher behavior는 아래 섹션의 contract를 따른다.

Hook 기반 상태는 실제 Codex session 상태의 authoritative source가 아니라 마지막으로 관측한 lifecycle event와 display-only 추론이다. `waiting_approval`과 `done`은 각각 `PermissionRequest`, `Stop`/`SubagentStop` event를 관측했음을 뜻하고, `stale`은 `active`, `running`, `tool_running` 상태에서 일정 시간 새 hook event가 없었다는 표시다.

현재 terminal MVP command contract:

- `codex-radar hook`: stdin에서 hook payload 1개를 읽어 기록한다.
- `codex-radar sessions`: 알려진 세션 목록을 출력한다. `--group-project`는 text output을 project header로 묶고 JSON output shape는 바꾸지 않는다.
- `codex-radar transcript <session-or-path>`: 로컬 transcript를 짧게 훑어본다.
- `codex-radar tui`: 가벼운 session dashboard를 연다.
- `codex-radar watch`: foreground watcher를 실행해 새 `done` session을 기본으로 terminal bell과 최소 metadata line으로 알린다. `--status`를 반복 지정해 `waiting_approval` 같은 다른 display status도 볼 수 있다.
- `codex-radar path`: active state directory를 출력한다. 이 command는 directory를 생성하지 않는 no-write discovery surface다.
- `codex-radar doctor`: 짧은 로컬 진단을 출력한다.
- `codex-radar config get [key]`: server-side `codex-radar` config를 출력한다. 현재 config key는 `retention_days`다.
- `codex-radar config set retention_days <days>`: server-side retention 기간을 일 단위로 저장한다. `0`은 pruning 비활성화를 뜻한다.
- `codex-radar prune`: `retention_days` 기준으로 오래된 session을 `sessions.json`에서 제거하고 legacy `events.jsonl`이 있으면 제거한다. `--dry-run`은 실제 변경 없이 제거 후보를 출력한다.
- `codex-radar completion <bash|zsh|fish>`: shell completion script를 stdout으로 출력한다.
- TUI는 선택한 session의 metadata와 transcript preview를 같은 terminal 안에서 보여준다.
- TUI에서 resumable session row를 선택하고 Enter를 누르면 curses UI를 종료한 뒤 같은 terminal에서 `codex resume <session_id>`를 실행한다.
- session id가 없거나 placeholder unknown id인 row는 resume disabled 상태로 표시하고 Enter resume을 수행하지 않는다.
- `sessions`와 `tui`는 `active`, `running`, `tool_running` 상태의 session이 30분 넘게 update되지 않으면 cache의 원본 `status`를 바꾸지 않고 display status를 `stale`로 보여준다.

## Current Architecture

`codex-radar`는 stdlib-first Python CLI다.

```text
Codex hook event
  -> codex-radar hook
  -> sessions.json latest-state session index
  -> sessions/transcript/tui commands
```

runtime state 기본 위치:

```text
$CODEX_RADAR_HOME
or $XDG_STATE_HOME/codex-radar
or ~/.local/state/codex-radar
```

state directory 구성:

- `sessions.json`: thread별 latest session index. GUI read contract v1 schema는 [schemas/session-cache-v1.schema.json](schemas/session-cache-v1.schema.json), example은 [../examples/sessions.json](../examples/sessions.json)에 둔다.
- `config.json`: server-side `codex-radar` config. 현재 `retention_days`만 정의하며 기본값은 7일이다.
- `.lock`: session index update 중 사용하는 coarse file lock.

Legacy state:

- 과거 버전이 만든 `events.jsonl`은 더 이상 기본 기록하지 않는다. hook update와 `codex-radar prune`은 legacy `events.jsonl`이 있으면 제거한다.

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

정규화된 event는 hook processing 중 session index update를 위한 in-memory record다. 현재 default runtime state에는 raw hook event log를 누적 저장하지 않는다.

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

현재 terminal MVP는 project column, TUI project group header, `sessions --group-project`, `--project` filter로 프로젝트 단위 구분과 narrowing을 제공한다. 향후 GUI 통합에서는 프로젝트 단위로 묶인 conversation list가 primary navigation surface가 되어야 한다.

Retention:

- `retention_days`는 `last_seen_at` 기준으로 Radar session index에 남길 기간을 뜻한다.
- 기본값은 7일이다.
- `0`은 pruning 비활성화를 뜻한다.
- hook update는 session index를 저장할 때 retention cutoff보다 오래된 session을 자동 제거한다.
- `codex-radar prune`은 같은 규칙을 명시적으로 실행하거나 `--dry-run`으로 제거 후보를 확인하는 운영 command다.
- retention pruning은 `sessions.json`과 legacy `events.jsonl`만 대상으로 한다. Codex transcript 파일, 공식 Codex thread, 공식 archive 상태는 건드리지 않는다.

## Planned GUI Integration Contract

첫 GUI milestone은 VS Code extension 같은 GUI surface가 extension host-local `codex-radar` state를 읽어 프로젝트 단위 conversation list와 thread attention state를 보여주는 read-only dashboard다. Remote SSH 사용 시 기본 관심사는 VS Code UI client machine의 Codex state가 아니라 remote workspace extension host 안의 Codex state와 transcript다.

VS Code extension scaffold는 `extensions/vscode/`에 둔다. Python core는 stdlib-first를 유지하고, Node/runtime/package metadata는 extension subtree에 격리한다. 별도 repository 분리는 marketplace, release, review lifecycle이 실제로 갈라질 때 재검토한다.

GUI read contract v1:

- 첫 milestone은 `sessions.json` 직접 read로 시작한다.
- `sessions.json`은 GUI read contract v1의 입력이지만 영구 public API로 과도하게 고정하지 않는다.
- GUI는 `codex-radar path`를 no-write state directory discovery command로 사용할 수 있다.
- VS Code extension은 Remote SSH workspace extension host에서 실행되어 그 host의 filesystem 기준으로 state와 transcript를 읽는 것을 기본 전제로 한다. UI client machine의 Codex state를 읽기 위해 `extensionKind: ["ui"]`를 강제하지 않는다.
- GUI implementation은 `SessionSource` 같은 얇은 read adapter를 두고 view/component code가 file read에 직접 결합하지 않게 한다.
- GUI는 `sessions.json` 생성/변경/삭제를 read-only로 watch해 navigation view를 refresh할 수 있다. 이 watcher는 state directory나 cache file을 생성하지 않고, 변경된 cache를 다시 읽는 역할만 한다.
- 나중에 schema evolution, computed field 증가, redaction/display policy 복잡화, cross-platform path 문제가 커지면 adapter를 `codex-radar sessions --json` 또는 별도 `export/gui-state` command로 교체할 수 있다.
- future CLI/export read adapter는 missing state directory에서 directory나 state file을 생성하지 않아야 한다.
- GUI는 `events.jsonl`을 기본 navigation 입력으로 읽지 않는다. 현재 default runtime state는 raw hook event log를 누적 저장하지 않는다.
- GUI는 `config.json`을 직접 수정하지 않고, server-side config 변경이 필요하면 `codex-radar config` 같은 Python core command를 통해 처리한다.

GUI display contract v1:

- GUI는 `project` 기준으로 conversation list를 묶는다.
- VS Code extension은 Explorer 하위 view가 아니라 dedicated Codex Radar Activity Bar container 안에 session navigation을 제공한다.
- VS Code session row는 readable title/snippet, scan-friendly status text, read/unread state, current tool/model/relative last-seen metadata를 표시한다. 기본 navigation의 snippet은 session cache의 redacted latest assistant summary를 사용하고 raw transcript file을 row마다 읽지 않는다.
- GUI는 `waiting_approval`, `running`, `done`, `stale`를 navigation 안에서 구분한다.
- GUI attention은 `waiting_approval`, `stale`, unread `done` session을 뜻한다. `running`과 `tool_running`은 상태로 표시하지만 attention count에는 포함하지 않는다.
- GUI는 attention-worthy session 수를 VS Code view badge 같은 in-surface cue로 보여줄 수 있다. 이 count는 현재 status filter와 무관하게 전체 loaded session 기준으로 계산한다.
- GUI는 `display_status` 기준으로 session list를 좁히는 read-only status filter를 제공할 수 있다. 첫 구현은 view-local temporary filter로 두며, session cache나 extension settings를 수정하지 않는다.
- GUI는 done session에 extension-local read/unread state를 유지할 수 있다. read key는 `session_id`와 done `last_seen_at` 기준이며, 같은 session이 다시 done 상태로 갱신되면 새 unread item으로 취급한다.
- `stale`은 cache의 원본 `status`를 바꾸지 않는 display-only status이며, terminal MVP와 같은 stale rule을 사용한다.
- 첫 notification surface는 VS Code extension 안의 badge/highlight 같은 in-surface attention cue로 제한한다.
- GUI는 session row click으로 experimental `Open in Codex` action을 제공할 수 있다. 이 action은 공식 Codex VS Code extension의 `vscode://openai.chatgpt/local/<session_id>` URI를 열어 해당 local thread route로 handoff를 시도한다. 이 URI는 공식 public contract가 아니라 current integration probe로 취급한다. done session을 성공적으로 열면 extension-local read state를 read로 갱신할 수 있다.
- GUI는 done session row의 inline action으로 read/unread를 토글할 수 있다.
- OS notification, external notification channel, toast content template은 별도 milestone 전까지 scope 밖이다.

GUI privacy/action boundary v1:

- 첫 GUI milestone은 read-only dashboard다.
- GUI는 `~/.codex/hooks.json`을 편집하지 않고, hook install을 자동화하지 않는다.
- GUI는 `codex resume` 같은 local command execution을 직접 수행하지 않는다. 공식 Codex extension URI handoff는 experimental action으로만 둔다. command copy나 terminal handoff는 별도 requirement에서 다룬다.
- GUI는 raw transcript file을 기본 list에 자동 노출하지 않는다. 기본 navigation에는 session cache의 redacted latest assistant summary를 짧은 식별 snippet으로 표시할 수 있지만 raw transcript path는 표시하지 않는다.
- VS Code extension은 transcript preview row action을 제공하지 않는다. 자세한 transcript 확인은 official Codex handoff 또는 terminal `codex-radar transcript` workflow에 맡긴다.
- GUI는 transcript/session metadata를 외부로 전송하지 않는다.

## Automation Boundary

허용:

- stdin에서 hook payload 1개 읽기.
- 설정된 state directory 아래에 로컬 상태 쓰기.
- server-side `codex-radar` config와 session index retention pruning.
- 사용자가 transcript/TUI command를 실행했을 때 로컬 transcript 파일 읽기.
- 사용자가 TUI에서 resumable row를 선택하고 Enter를 눌렀을 때 같은 terminal process를 `codex resume <session_id>`로 교체하기.

금지:

- `~/.codex/hooks.json` 자동 편집.
- notification, telemetry, transcript, session metadata를 외부 서비스로 전송.
- Codex transcript 삭제.
- raw hook event log 기본 누적 저장.
- `cwd`로 관찰한 repository 수정.

## Foreground Watcher

`codex-radar watch`는 명시적으로 실행했을 때만 동작하는 opt-in local watcher다.

- `sessions.json`을 polling한다.
- 기본으로 새 `done` session만 alert한다.
- `--status <display-status>`를 반복 지정하면 `done`, `waiting_approval` 같은 여러 display status를 watch할 수 있다.
- 시작 시 현재 session 수와 matching session 수를 한 줄로 출력해 watcher가 살아 있는지 보여준다.
- 기본값은 watcher 시작 전에 이미 matching 상태였던 session을 alert하지 않는다.
- `--include-existing`을 지정하면 시작 시 이미 matching 상태인 session도 alert한다.
- alert 내용은 display status, project basename, event name으로 제한한다.
- 기본 alert는 terminal bell과 한 줄 출력이다.
- `--no-bell`을 지정하면 terminal bell 없이 한 줄만 출력한다.
- `--quiet-start`를 지정하면 시작 summary line을 출력하지 않는다.
- hook path에서는 notification이나 bell을 직접 보내지 않는다.
- 이 watcher는 terminal에서 직접 켜두는 MVP/fallback 알림 표면이며, 향후 VS Code extension 같은 GUI 통합 요구사항을 대체하지 않는다.

## Privacy Boundary

Transcript와 hook payload에는 private path, prompt, code, command output, secret이 포함될 수 있다. `codex-radar`는 이를 민감한 로컬 데이터로 취급한다.

Transcript skim output은 흔한 secret-like token을 best-effort로 redact하지만, 이것은 security boundary가 아니다.

## Tests / Checks

- `PYTHONPATH=src python3 -m unittest discover`
- `python3 -m compileall src tests`
- 현재 테스트는 hook event normalization/cache update, no-default event log, config/pruning, stale display status, session filters, transcript skim/redaction, TUI project grouping, TUI resume guard, status watcher, shell completion을 보호한다.

## Non-goals

- cloud sync 없음.
- live token streaming 없음.
- Codex native transcript viewer를 대체하지 않음.
- OS notification, external notification channel 없음.
