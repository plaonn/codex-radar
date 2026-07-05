# codex-radar 지침

이 저장소는 로컬 Codex 세션을 모니터링하는 도구를 만든다.

편집 전:
- 이 파일을 읽는다.
- 현재 requirement와 RDD hierarchy는 `docs/REQUIREMENTS.md`를 읽는다.
- 현재 동작과 계약은 `docs/SPEC.md`를 읽는다.
- 미래 방향이나 scope를 바꿀 때는 `docs/ROADMAP.md`를 읽는다.
- tracked public 파일을 active task dashboard로 쓰지 않는다. 사용 가능하면 maintainer가 제공하는 private task surface를 사용한다.

엔지니어링 규칙:
- hook 경로는 빠르고, 로컬 전용이며, dependency-light하게 유지한다.
- Codex transcript는 민감한 로컬 데이터로 취급한다. transcript, session state, raw hook log, private path, secret, generated runtime state를 commit하지 않는다.
- 최신 session index는 `sessions.json`에 thread별 마지막으로 알려진 정보만 유지한다. legacy `events.jsonl` 같은 raw hook event log는 기본 기록하지 않는다.
- 일반 개발 명령이나 테스트에서 전역 Codex config를 수정하지 않는다. `~/.codex/hooks.json` 자동 수정 대신 예시와 runbook을 제공한다.
- `docs/REQUIREMENTS.md`와 `docs/SPEC.md`가 dependency를 정당화하기 전까지는 stdlib-first Python을 유지한다.
- VS Code extension은 `extensions/vscode/` 아래에 둔다. Python core는 stdlib-first를 유지하고, Node/extension dependency와 build artifact는 extension subtree에 격리한다.
- private task list, external task mapping detail, local thread ID, operator note를 tracked public 파일에 넣지 않는다.

검증:
- 코드 변경 후 `PYTHONPATH=src python3 -m unittest discover`를 실행한다.
- Python 구조 변경 후 `python3 -m compileall src tests`를 실행한다.
- VS Code extension 변경 후 `npm --prefix extensions/vscode test`를 실행한다.
- VS Code extension 구현을 완료했으면 시험용 VSIX 생성을 위해 `npm --prefix extensions/vscode run package`도 실행한다. 생성된 `.vsix`는 gitignored artifact이며 commit하지 않는다.
