# codex-radar

로컬 Codex 세션을 터미널에서 빠르게 확인하는 radar.

`codex-radar`는 Codex lifecycle hook을 받아 로컬 세션 metadata를 프로젝트별로 인덱싱하고, 현재 상태나 최근 대화 내용을 터미널에서 빠르게 확인할 수 있게 한다.

## 상태

초기 로컬 MVP 상태다. hook indexer, session list, transcript skim, dependency-free TUI가 들어가 있다.

Notification 전송과 hook 자동 설치는 privacy boundary가 별도로 정해질 때까지 의도적으로 scope 밖에 둔다.

## 개발 설치

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .
```

## 명령

```bash
codex-radar hook              # stdin의 hook JSON payload 1개 기록
codex-radar sessions          # 인덱싱된 세션 목록 출력
codex-radar transcript <id>   # session id 또는 path로 transcript 훑어보기
codex-radar tui               # 터미널 dashboard 열기
codex-radar path              # state directory 출력
codex-radar doctor            # 짧은 로컬 진단 출력
```

`codex-radar tui`에서는 `up/down` 또는 `j/k`로 session을 선택하고, 하단 preview에서 최근 transcript skim을 확인한다. Enter는 resumable row에서 같은 terminal을 `codex resume <session_id>`로 전환한다. session id가 없거나 placeholder unknown id인 row는 disabled로 표시된다.

`active`, `running`, `tool_running` session이 30분 넘게 update되지 않으면 `sessions`와 `tui`에서 `stale`로 표시된다. cache의 원본 status는 바꾸지 않는다.

`codex-radar sessions`는 `--project`, `--status`, `--model`, `--since` 필터를 지원한다. `--since`는 `last_seen_at` 기준이며 ISO-8601 timestamp 또는 `30m`, `2h`, `7d` 같은 duration을 받는다.

```bash
codex-radar sessions --model gpt-5 --since 2h
codex-radar sessions --status stale
```

runtime state 기본 위치:

```text
$CODEX_RADAR_HOME
or $XDG_STATE_HOME/codex-radar
or ~/.local/state/codex-radar
```

## Hook 설정

[docs/runbooks/install-hooks.md](docs/runbooks/install-hooks.md)를 따른다.

`examples/hooks.json`은 user-level Codex hook 예시다. `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop` event를 `codex-radar hook`으로 보낸다.

## RDD 표면

- [docs/SPEC.md](docs/SPEC.md): 현재 동작, requirement, data model, automation/privacy boundary.
- [docs/ROADMAP.md](docs/ROADMAP.md): 미래 방향과 non-goal.

Active task tracking은 tracked public 파일에 저장하지 않는다.

## 검증

```bash
PYTHONPATH=src python3 -m unittest discover
python3 -m compileall src tests
```
