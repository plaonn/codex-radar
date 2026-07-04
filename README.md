# codex-radar

원격 개발 환경에서 로컬 Codex thread 상태를 빠르게 확인하는 radar.

`codex-radar`는 VS Code Remote SSH와 로컬 Codex를 함께 쓰는 환경에서 Codex lifecycle hook을 받아 세션 metadata를 프로젝트별로 인덱싱하고, 프로젝트 단위로 thread를 구분해 현재 상태나 최근 대화 내용을 빠르게 확인할 수 있게 한다. 최종적으로는 VS Code extension 같은 GUI surface와 통합하는 것을 지향하지만, 초기 MVP는 terminal-first workflow를 제공한다.

## 상태

초기 로컬 MVP 상태다. hook indexer, session list, transcript skim, dependency-free TUI가 들어가 있다.

VS Code extension 또는 유사 GUI 통합은 experimental direction이다. OS/external notification 전송과 hook 자동 설치는 privacy boundary가 별도로 정해질 때까지 의도적으로 scope 밖에 둔다.

VS Code extension scaffold는 [extensions/vscode](extensions/vscode)에 둔다. Python core는 stdlib-first를 유지하고, extension runtime과 Node 관련 파일은 이 subtree에 격리한다.

## 개발 설치

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .
```

## 명령

```bash
codex-radar hook              # stdin의 hook JSON payload 1개로 session index 갱신
codex-radar sessions          # 인덱싱된 세션 목록 출력
codex-radar transcript <id>   # session id 또는 path로 transcript 훑어보기
codex-radar tui               # 터미널 dashboard 열기
codex-radar watch             # done foreground watcher 실행
codex-radar path              # state directory 출력
codex-radar doctor            # 짧은 로컬 진단 출력
codex-radar config get        # server-side codex-radar config 출력
codex-radar config set retention_days 7
codex-radar prune             # retention 기준으로 오래된 Radar session 제거
codex-radar completion <sh>   # bash, zsh, fish completion script 출력
```

`codex-radar tui`에서는 session이 project header 아래에 묶여 표시된다. `up/down` 또는 `j/k`로 session을 선택하고, 하단 preview에서 최근 transcript skim을 확인한다. Enter는 resumable row에서 같은 terminal을 `codex resume <session_id>`로 전환한다. session id가 없거나 placeholder unknown id인 row는 disabled로 표시된다.

`active`, `running`, `tool_running` session이 30분 넘게 update되지 않으면 `sessions`와 `tui`에서 `stale`로 표시된다. cache의 원본 status는 바꾸지 않는다.

`codex-radar sessions`와 `codex-radar tui`는 project column과 `--project`, `--status`, `--model`, `--since` 필터를 지원한다. `codex-radar sessions --group-project`는 text output을 project header로 묶어 보여주며 JSON output shape는 바꾸지 않는다. `--since`는 `last_seen_at` 기준이며 ISO-8601 timestamp 또는 `30m`, `2h`, `7d` 같은 duration을 받는다.

```bash
codex-radar sessions --model gpt-5 --since 2h
codex-radar sessions --status stale
codex-radar sessions --group-project
codex-radar tui --project codex-radar --since 1d
```

`retention_days`는 server-side config이며 기본값은 7일이다. hook update는 이 기준으로 오래된 Radar session을 `sessions.json`에서 자동 제거한다. `0`은 pruning 비활성화다. `codex-radar prune`은 같은 규칙을 수동 실행하거나 `--dry-run`으로 확인하는 운영 command다. 과거 버전이 만든 legacy `events.jsonl`은 hook update 또는 prune 시 제거된다. Codex transcript 파일이나 공식 Codex thread/archive 상태는 건드리지 않는다.

```bash
codex-radar config get retention_days
codex-radar config set retention_days 14
codex-radar prune --dry-run
codex-radar prune
```

`codex-radar watch`는 opt-in foreground watcher다. state cache를 polling하다가 새 `done` session을 보면 terminal bell과 최소 metadata line을 출력한다. 시작 시 현재 session 수와 matching 수를 출력하며, 시작 전에 이미 `done`이었던 session은 기본으로 다시 알리지 않는다. 기존 session도 보고 싶으면 `--include-existing`, 승인 대기까지 같이 보고 싶으면 `--status done --status waiting_approval`을 사용한다. hook path에서는 notification을 보내지 않는다. 이 command는 terminal MVP/fallback이며 future GUI integration을 대체하지 않는다.

Shell completion은 script를 출력해서 사용한다.

```bash
codex-radar completion zsh > ~/.zfunc/_codex-radar
codex-radar completion bash > ~/.local/share/bash-completion/completions/codex-radar
codex-radar completion fish > ~/.config/fish/completions/codex-radar.fish
```

runtime state 기본 위치:

```text
$CODEX_RADAR_HOME
or $XDG_STATE_HOME/codex-radar
or ~/.local/state/codex-radar
```

Future GUI integration은 작은 adapter를 통해 `sessions.json`을 직접 읽는 방식으로 시작한다. v1 cache schema는 [docs/schemas/session-cache-v1.schema.json](docs/schemas/session-cache-v1.schema.json), 예시는 [examples/sessions.json](examples/sessions.json)에 둔다.

VS Code extension은 기본 navigation을 위해 `sessions.json`을 직접 읽고, retention 설정/정리는 `codex-radar config`와 `codex-radar prune` CLI를 호출한다. CLI executable은 extension setting `codexRadar.cliPath`로 override할 수 있다.

## VS Code extension VSIX

VS Code extension은 아직 Marketplace에 publish하지 않는다. 현재 release path는 local VSIX를 만들고, explicit approval 뒤 GitHub Release artifact로 attached distribution하는 방식이다.

```bash
npm --prefix extensions/vscode test
npm --prefix extensions/vscode run package
code --install-extension extensions/vscode/codex-radar-vscode-0.1.7.vsix --force
```

Remote SSH smoke test, privacy boundary, version policy, release checklist는 [extensions/vscode/README.md](extensions/vscode/README.md)에 둔다. 변경 이력은 [extensions/vscode/CHANGELOG.md](extensions/vscode/CHANGELOG.md)에 둔다. 생성된 `.vsix`는 gitignored artifact이며 repository에 commit하지 않는다.

## Hook 설정

[docs/runbooks/install-hooks.md](docs/runbooks/install-hooks.md)를 따른다.

`examples/hooks.json`은 user-level Codex hook 예시다. `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop` event를 `codex-radar hook`으로 보낸다.

## RDD 표면

- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md): root goal, RDD requirement hierarchy, rationale, failure prevented.
- [docs/SPEC.md](docs/SPEC.md): 현재 terminal MVP 동작, data model, automation/privacy boundary.
- [docs/ROADMAP.md](docs/ROADMAP.md): 미래 방향과 non-goal.

Active task tracking은 tracked public 파일에 저장하지 않는다.

## 검증

```bash
PYTHONPATH=src python3 -m unittest discover
python3 -m compileall src tests
npm --prefix extensions/vscode test
```
