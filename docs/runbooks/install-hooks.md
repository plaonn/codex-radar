# Codex Hook 설치

이 runbook은 `codex-radar`를 user-level Codex hook으로 연결하는 절차다.

## 전제

- Codex가 사용하는 shell 환경에서 `codex-radar` command를 실행할 수 있어야 한다.
- Codex hook payload와 session transcript에는 private local data가 들어갈 수 있음을 이해해야 한다.

로컬 개발 설치:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .
```

## 예시 Hook Config 확인

```bash
sed -n '1,220p' examples/hooks.json
```

## 수동 설치

`examples/hooks.json` 내용을 아래 파일에 merge한다.

```text
~/.codex/hooks.json
```

이미 `~/.codex/hooks.json`이 있으면 unrelated hook을 덮어쓰지 말고 `hooks` object만 병합한다.

## Hook Trust

Codex를 시작하거나 resume한 뒤, Codex가 hook review를 요구하면 `/hooks`에서 변경된 hook을 검토하고 trust한다.

## 검증

짧은 Codex turn을 한 번 실행한 뒤 확인한다.

```bash
codex-radar sessions
codex-radar tui
```

state file 위치 확인:

```bash
codex-radar path
```

## 제거

`~/.codex/hooks.json`에서 `codex-radar hook` entry를 제거한다.
