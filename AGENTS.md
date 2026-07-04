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
- event는 append-only로 기록하고, 최신 상태는 derived cache로 관리하는 방식을 선호한다.
- 일반 개발 명령이나 테스트에서 전역 Codex config를 수정하지 않는다. `~/.codex/hooks.json` 자동 수정 대신 예시와 runbook을 제공한다.
- `docs/SPEC.md`의 requirement가 dependency를 정당화하기 전까지는 stdlib-first Python을 유지한다.
- private task list, external task mapping detail, local thread ID, operator note를 tracked public 파일에 넣지 않는다.

검증:
- 코드 변경 후 `PYTHONPATH=src python3 -m unittest discover`를 실행한다.
- Python 구조 변경 후 `python3 -m compileall src tests`를 실행한다.
