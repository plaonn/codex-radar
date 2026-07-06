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
- `codex-radar usage`: host-local Codex rollout JSONL에서 최신 `token_count` usage snapshot을 read-only로 읽는다. `--json`은 VS Code와 automation이 사용하기 쉬운 JSON contract를 출력한다.
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

## Usage Snapshot

`codex-radar usage`는 experimental host-local Codex usage adapter다. VS Code Remote SSH, Dev Container, WSL, local window 모두에서 실행 중인 VS Code extension host 기준 `CODEX_HOME` 또는 `~/.codex`를 사용한다. Remote SSH window에서는 remote host의 Codex state를 읽고, local VS Code window에서는 local host의 Codex state를 읽는다.

Input:

- 기본 Codex home: `$CODEX_HOME` 또는 `~/.codex`.
- scan 대상: `<codex-home>/sessions/**/rollout-*.jsonl` 중 mtime 기준 최신 파일 일부.
- 추출 대상: 최신 `payload.type == "token_count"` event의 `info`와 `rate_limits`.

Output:

- `available`: usable `rate_limits` snapshot이 있으면 `true`.
- `source`: `codex-session-rollout`.
- `primary` / `secondary`: `used_percent`, computed `remaining_percent`, `window_minutes`, `resets_at`, `resets_at_iso`.
- `plan_type`, `context_window`, `last_token_usage`, `total_token_usage`: rollout event가 제공하는 요약 값.
- `reason`: unavailable일 때 `token_count_unavailable` 또는 `rate_limits_unavailable`.

Privacy and stability boundary:

- 이 adapter는 Codex의 공식 stable usage API가 아니라 host-local rollout JSONL의 current observed shape를 읽는 experimental adapter다.
- `auth.json`을 읽지 않고, 서버 요청을 보내지 않고, Codex config/hook/session을 수정하지 않는다.
- raw rollout line, raw transcript content, private rollout file path는 output model이나 Radar state에 저장하지 않는다.
- `rate_limits`가 없거나 schema가 바뀌면 정상적인 unavailable snapshot으로 처리한다.

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

## VS Code GUI Contract

현재 GUI surface는 VS Code extension의 Codex Radar Activity Bar sectioned Webview sidebar와 editor-area Webview dashboard로 구성된다. Sidebar는 좁은 폭에서 항상 켜두는 ambient monitor이며 VS Code native collapsible view section shell로 `Attention`, `Projects`, collapsed `Archived` sections를 제공하고, 각 section body는 Webview content로 렌더링한다. Webview dashboard는 `Codex Radar: Open Dashboard` command로 editor tab에 열리며 프로젝트 단위 conversation list, attention inbox, selected-session inspector, archived-session surface를 넓은 화면에서 제공한다. Remote SSH 사용 시 기본 관심사는 VS Code UI client machine의 Codex state가 아니라 remote workspace extension host 안의 Codex state와 transcript다.

VS Code extension scaffold는 `extensions/vscode/`에 둔다. Python core는 stdlib-first를 유지하고, Node/runtime/package metadata는 extension subtree에 격리한다. 별도 repository 분리는 marketplace, release, review lifecycle이 실제로 갈라질 때 재검토한다.

GUI read contract v1:

- 첫 milestone은 `sessions.json` 직접 read로 시작한다.
- `sessions.json`은 GUI read contract v1의 입력이지만 영구 public API로 과도하게 고정하지 않는다.
- GUI는 `codex-radar path`를 no-write state directory discovery command로 사용할 수 있다.
- VS Code extension은 Remote SSH workspace extension host에서 실행되어 그 host의 filesystem 기준으로 state와 transcript를 읽는 것을 기본 전제로 한다. UI client machine의 Codex state를 읽기 위해 `extensionKind: ["ui"]`를 강제하지 않는다.
- VS Code extension manifest는 `extensionKind: ["workspace"]`로 workspace extension host execution을 명시한다.
- GUI implementation은 `SessionSource` 같은 얇은 read adapter를 두고 view/component code가 file read에 직접 결합하지 않게 한다.
- GUI는 `sessions.json` 생성/변경/삭제를 read-only로 watch해 navigation view를 refresh할 수 있다. 이 watcher는 state directory나 cache file을 생성하지 않고, 변경된 cache를 다시 읽는 역할만 한다.
- GUI는 host-local `codex app-server`의 experimental `thread/list`를 read-only optional metadata catalog로 호출해 exact `session_id` match 기준 title과 archived id를 보강할 수 있다. 이 호출은 `turn/start`를 만들지 않고 모델 작업을 시작하지 않으며, 실패/timeout 시 기존 `sessions.json`과 transcript-derived display field로 fallback한다.
- 나중에 schema evolution, computed field 증가, redaction/display policy 복잡화, cross-platform path 문제가 커지면 adapter를 `codex-radar sessions --json` 또는 별도 `export/gui-state` command로 교체할 수 있다.
- future CLI/export read adapter는 missing state directory에서 directory나 state file을 생성하지 않아야 한다.
- GUI는 `events.jsonl`을 기본 navigation 입력으로 읽지 않는다. 현재 default runtime state는 raw hook event log를 누적 저장하지 않는다.
- GUI는 `config.json`을 직접 수정하지 않는다. server-side config 변경이 필요하면 terminal `codex-radar config` 같은 Python core command를 사용한다.

GUI display contract v1:

- GUI는 `project` 기준으로 conversation list를 묶는다.
- VS Code extension은 Explorer 하위 view가 아니라 dedicated Codex Radar Activity Bar container 안에 `Attention`, `Projects`, `Archived` Webview sidebar sections를 제공한다.
- Sidebar `Attention` Webview는 `waiting_approval`과 unread `done` session을 cross-project inbox처럼 모은다.
- Sidebar `Projects` Webview는 project group navigation을 유지하고, project header를 fold/unfold 가능한 navigation row로 표시한다. Status filter가 없을 때 attention이 없는 quiet project는 기본 collapsed 상태로 시작할 수 있고, filter가 켜져 있으면 matching session을 바로 확인할 수 있도록 project groups는 펼쳐진다.
- Sidebar `Archived` Webview는 host-local Codex archived transcript store로 resolve되는 session을 collapsed native section 안에서 보여준다.
- Webview에는 extension host가 만든 sanitized dashboard view model만 전달한다. Sidebar Webview script와 editor dashboard script는 `sessions.json`, transcript, hook config, server-side `config.json`을 직접 읽거나 쓰지 않는다.
- Editor dashboard는 `Attention`, project-grouped session list, selected-session inspector를 같은 wide surface에 보여준다.
- Archived session은 `Attention`과 project list에서 제외되지만 sidebar `Archived` section 또는 dashboard archived list에서 선택할 수 있다.
- Sidebar body는 VS Code native section header와 같은 이름의 duplicate header panel을 렌더링하지 않고 바로 list content를 보여준다. Section-level count는 VS Code view badge 같은 native section affordance를 사용한다.
- Sidebar card와 dashboard card/inspector는 readable title/snippet, scan-friendly status text, read/unread state, current tool/model/relative last-seen metadata를 표시한다. 기본 title/snippet은 host-local transcript에서 redacted display fields로 파생할 수 있다. Title은 첫 displayable Codex message 직전의 user request에서 추출하고, snippet은 마지막 displayable user/Codex activity와 speaker badge를 사용한다. Raw transcript path/content는 Webview card model에 전달하지 않는다.
- Host-local app-server `thread/list`가 title을 제공하면 GUI는 exact `session_id`와, 둘 다 있을 경우 exact `cwd`가 일치하는 항목에 한해 해당 title을 transcript-derived title보다 우선 표시할 수 있다. `thread/list`의 `status` 값(`notLoaded`, `idle`, `active` 등)은 Codex client/app-server loading state이므로 Radar lifecycle status, attention count, status filter에는 사용하지 않는다.
- Sidebar/dashboard selection follows the stable Codex session identity across refreshes. Display row keys can include changing timestamp/read-state fields, but refresh must not move the selected row to another session while the selected session is still present.
- Sidebar/dashboard session item context menu는 default cut/copy/paste edit menu를 대체하고 session id 복사 같은 session-specific action을 제공할 수 있다.
- Sidebar item selection opens a `Codex Radar Preview` editor tab for the selected session. The preview uses a fixed header for title/session metadata and a transcript-only scroll body; when a new session preview is opened, the transcript body initially scrolls to the latest message. Refreshes for the same selected session preserve the user's current scroll position unless the user was already near the bottom, in which case the preview stays at the latest message. The preview stays bound to the explicitly opened session identity during refresh and must not switch to another dashboard/sidebar fallback selection. The preview shows session metadata and a bounded redacted transcript skim when the transcript file is available on the extension host; the current default window is the latest 120 user/Codex messages. If the session cache has no `transcript_path`, the VS Code extension can fall back to the host-local Codex transcript store by session id. If a cached `transcript_path` no longer exists because the file moved to `~/.codex/archived_sessions`, the extension can resolve the archived transcript by matching the file name. If no transcript file can be found, the preview can show the cached latest Codex summary with an explanatory note. The skim parses Codex JSONL wrapper shapes such as `response_item.payload` and `event_msg.payload`, filters to user/Codex conversation messages, removes adjacent duplicate surfaced messages, hides tool/internal events by default, and renders messages as chat bubbles with safe Markdown support.
- GUI는 lifecycle status(`waiting_approval`, `running`, `tool_running`, `done`, `unknown`), done read state, and archived state를 분리해 표시한다.
- GUI에서 `running`과 `tool_running`은 무채색 loading spinner로 표시한다.
- GUI에서 unread `done`은 blue/cyan filled indicator와 bold title로 표시하고, read `done`은 hollow gray indicator와 normal/muted title 및 muted row treatment로 표시한다.
- GUI에서 `unknown`은 colored `!` indicator로 표시한다.
- GUI attention은 `waiting_approval`과 unread `done` session을 뜻한다. `running`과 `tool_running`, read `done`은 상태로 표시하지만 attention count에는 포함하지 않는다.
- GUI는 attention-worthy session 수를 sidebar view badge, dashboard topbar, attention pane count 같은 in-surface cue로 보여준다. 이 count는 현재 status filter와 무관하게 전체 loaded visible session 기준으로 계산한다.
- GUI는 host-local Codex usage snapshot을 VS Code status bar에 표시할 수 있다. 표시 대상은 primary/secondary remaining percent이며, 예시는 `29% · 89%` 형태다. Tooltip과 click detail은 `5h: 29% remaining`, ` - reset: 4h 11m left (2026-07-06 13:20:08)`, `7d: 89% remaining`, `Plan: prolite`처럼 extension host local time 기준의 압축된 잔여량 중심 형식으로 표시한다. Usage unavailable 상태는 오류로 띄우지 않고 muted status item으로 표시한다.
- GUI는 lifecycle status 기준으로 project session list를 좁히는 read-only status filter를 제공한다. `attention` filter는 attention state 기준으로 좁힌다. Sidebar에서는 native section title의 filter button을 entrypoint로 쓰고 Webview body 안에 별도 filter control이나 duplicate section title을 배치하지 않는다. Editor dashboard에서는 넓은 surface의 topbar select를 filter entrypoint로 둔다. 현재 구현은 view-local temporary filter로 두며, session cache나 extension settings를 수정하지 않는다.
- GUI는 done session에 extension-local read/unread state를 유지할 수 있다. read key는 `session_id`와 done `last_seen_at` 기준이며, 같은 session이 다시 done 상태로 갱신되면 새 unread item으로 취급한다. Done row/card와 inspector action은 unread/read 상태를 구분해야 하며, read/unread action은 hide/show를 암시하는 eye icon이나 wording을 쓰지 않는다.
- GUI는 Codex archived session을 `Archived`로 표시한다. Archived 판정은 `sessions.json`의 transcript path가 host-local Codex archived store 아래에 있거나, cached transcript path가 없어도 session id/file name matching으로 `~/.codex/archived_sessions` 또는 `CODEX_HOME/archived_sessions`에서 transcript file이 발견되는 경우다. 보조 판정으로 host-local Codex app-server `thread/list archived=true` 결과 또는 `state_5.sqlite`의 archived thread state를 read-only로 참고하되, thread id가 `session_id`와 직접 일치하는 archived thread만 archived로 취급한다. `cwd`와 시간 범위만으로 transcript-less side session을 archived parent에 추정 연결하지 않는다. Archived session은 사용자가 이미 Codex에서 archive한 session으로 취급하며, GUI는 `Open in Codex` action을 비활성화한다.
- Terminal MVP에서 `stale`은 cache의 원본 `status`를 바꾸지 않는 display-only status이며, 현재 CLI/TUI rule은 `active`, `running`, `tool_running`이 30분 넘게 갱신되지 않은 경우다. VS Code GUI는 `stale` freshness modifier를 표시하지 않는다.
- 첫 notification surface는 VS Code extension 안의 count/highlight 같은 in-surface attention cue로 제한한다.
- GUI는 sidebar card action과 selected-session inspector에서 experimental `Open in Codex` action을 제공할 수 있다. 이 action은 공식 Codex VS Code extension의 `vscode://openai.chatgpt/local/<session_id>` URI를 열어 해당 local thread route로 handoff를 시도한다. 이 URI는 공식 public contract가 아니라 current integration probe로 취급한다. Archived session은 공식 Codex extension에서 열 수 없는 것으로 보고 handoff를 막는다. Host-local Codex rollout/transcript file이 session id로 resolve되지 않는 session도 Codex resume 대상이 없을 수 있으므로 handoff를 막는다. done session을 성공적으로 열면 extension-local read state를 read로 갱신할 수 있다.
- GUI는 sidebar card action 또는 selected-session inspector action으로 read/unread를 토글할 수 있다.
- 현재 VS Code GUI는 retention config/prune controls를 노출하지 않는다. server-side retention 운영은 terminal `codex-radar config`와 `codex-radar prune` workflow에 맡긴다.
- OS notification, external notification channel, toast content template은 별도 milestone 전까지 scope 밖이다.

GUI privacy/action boundary v1:

- 첫 GUI milestone은 Codex/codex-radar runtime state에 대해 read-only dashboard다. Extension-local read/unread UI state는 허용하지만, `sessions.json`, transcript, Codex thread, hook config, server-side `config.json`은 수정하지 않는다.
- GUI의 app-server `thread/list` 사용은 read-only metadata lookup으로 제한한다. GUI는 이 경로에서 `thread/list`만 호출하고 `turn/start`, `thread/name/set`, archive/delete/update 같은 Codex state-changing method는 호출하지 않는다.
- GUI usage status bar는 Codex rollout JSONL을 read-only로 읽을 수 있지만 `auth.json`을 읽거나 서버 요청을 보내지 않는다.
- GUI는 `~/.codex/hooks.json`을 편집하지 않고, hook install을 자동화하지 않는다.
- GUI는 `codex resume` 같은 local command execution을 직접 수행하지 않는다. 공식 Codex extension URI handoff는 experimental action으로만 둔다. command copy나 terminal handoff는 별도 requirement에서 다룬다.
- 현재 VS Code GUI는 Python core CLI를 실행하지 않는다. retention config/prune GUI는 clearer surface가 생길 때 별도 requirement로 재도입한다.
- GUI는 raw transcript file을 기본 list에 자동 노출하지 않는다. 기본 navigation에는 host-local transcript에서 파생한 redacted title/snippet display fields를 표시할 수 있지만 raw transcript path나 raw transcript content는 표시하지 않는다.
- VS Code extension은 sidebar item selection처럼 사용자가 명시적으로 고른 단일 session에 한해 editor preview에서 transcript skim을 제공할 수 있다. Preview Webview에는 extension host가 만든 bounded, redacted user/Codex message entries와 sanitized Markdown HTML만 전달하고 raw transcript path나 tool/internal event text는 표시하지 않는다. `sessions.json`에 transcript path가 없으면 extension host의 `CODEX_HOME` 또는 `~/.codex` 아래 Codex transcript store에서 session id가 포함된 `.jsonl` 파일을 read-only로 찾을 수 있다. transcript file을 찾지 못하면 extension은 cached latest assistant summary만 fallback으로 표시할 수 있다. 전체 transcript 확인은 official Codex handoff 또는 terminal `codex-radar transcript` workflow에 맡긴다.
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
- 현재 테스트는 hook event normalization/cache update, no-default event log, config/pruning, stale display status, session filters, transcript skim/redaction, TUI project grouping, TUI resume guard, status watcher, shell completion, VS Code sidebar/dashboard/preview view model/manifest를 보호한다.

## Non-goals

- cloud sync 없음.
- live token streaming 없음.
- Codex native transcript viewer를 대체하지 않음.
- OS notification, external notification channel 없음.
