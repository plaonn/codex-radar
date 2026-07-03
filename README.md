# codex-radar

로컬 Codex 세션을 터미널에서 빠르게 확인하는 radar.

`codex-radar`는 Codex lifecycle hook을 받아 로컬 세션 metadata를 프로젝트별로 인덱싱하고, 현재 상태나 최근 대화 내용을 터미널에서 빠르게 확인할 수 있게 한다.

## 상태

초기 로컬 MVP 상태다. hook indexer, session list, transcript skim, dependency-free TUI scaffold가 들어가 있다.

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
