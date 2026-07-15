# Codex Hook Installation

## English

This runbook connects a host-local Codex Radar helper to user-level Codex lifecycle hooks. Hook configuration is always an explicit user action. Neither the helper installer nor the VS Code extension edits `~/.codex/hooks.json`.

### Requirements

- POSIX host with Python 3.9 or later.
- A Codex Radar helper bundle from a GitHub Release, or a source installation for development.
- Awareness that hook payloads and session transcripts may contain sensitive local data.

### Install a Release Helper Bundle

Download the bundle, checksum, and release notes from the intended GitHub Release/account over trusted TLS. The adjacent `.sha256` verifies bundle integrity, not publisher authenticity; a checksum served beside a compromised bundle cannot establish trust. The standalone `install-helper.py` is bootstrap code and must come from that same trusted release.

Verify the downloaded `codex-radar-helper-<version>.zip`, then extract it. On the supported Linux/Remote SSH path:

```bash
sha256sum --check codex-radar-helper-<version>.zip.sha256
unzip codex-radar-helper-<version>.zip
cd codex-radar-helper-<version>
```

From the extracted directory run:

```bash
python3 install-helper.py install .
```

The installer verifies every bundle artifact against `helper-manifest.json`, extracts the pure-Python wheel into an immutable runtime directory, and atomically selects it through:

```text
~/.local/share/codex-radar/runtime/current
```

It creates stable user-level symlinks under `~/.local/bin`, including the hook command:

```text
~/.local/bin/codex-radar-hook
```

It does not edit Codex configuration. If `~/.local/bin` already contains a non-symlink with one of the managed command names, installation stops instead of overwriting it.

Inspect installed and retained runtimes:

```bash
~/.local/bin/codex-radar-helper status
```

Run a read-only check of the selected runtime, stable shims, local Python compatibility, and actual hook wiring:

```bash
~/.local/bin/codex-radar-helper diagnose
```

The JSON result uses path-free status codes. Extension compatibility is limited to the range declared by the installed helper; it does not check whether a newer release exists. Use `--hooks-file PATH` only to inspect a non-default hook configuration.

After an upgrade, roll back atomically to the previously selected runtime:

```bash
~/.local/bin/codex-radar-helper rollback
```

An explicit retained version may also be selected:

```bash
~/.local/bin/codex-radar-helper rollback <runtime-version>
```

### Development Source Install

The legacy `codex-radar hook` command remains compatible for the public-beta migration window. A source checkout can install the same dedicated `codex-radar-hook` entrypoint:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .
codex-radar-hook --help
```

Source-checkout commands are not the stable release hook path. Use the helper bundle for a checkout-independent fixed shim.

### Preview the Exact Hook Configuration

Print a complete fragment with the absolute hook shim for the current user:

```bash
~/.local/bin/codex-radar-helper hook-config
```

Preview a unified diff against an existing file without writing it:

```bash
~/.local/bin/codex-radar-helper hook-config --hooks-file ~/.codex/hooks.json
```

Review the output, then manually merge the proposed `hooks` entries into `~/.codex/hooks.json`. Preserve unrelated hooks. [`examples/hooks.json`](../../examples/hooks.json) shows the exact event shape, but its `/home/YOUR_USER` placeholder must be replaced with the absolute path printed by `hook-config`.

The managed events are `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, and `Stop`. They all invoke the same fixed absolute `codex-radar-hook` shim with a five-second timeout.

### Trust and Verify

Start or resume Codex. If Codex asks for hook review, inspect and trust the hook through `/hooks`. Run a short turn, then verify:

```bash
~/.local/bin/codex-radar sessions
~/.local/bin/codex-radar doctor
~/.local/bin/codex-radar path
```

### Disable or Remove Hook Wiring

Remove only the Codex Radar entries from `~/.codex/hooks.json`; do not delete unrelated hooks. This stops new lifecycle updates without deleting Radar state or retained helper runtimes.

Removing the stable symlinks or runtime directories is a separate manual cleanup action. The manager intentionally does not change hook configuration during install, upgrade, rollback, or cleanup.

`codex-radar-helper diagnose` detects missing or mismatched stable shims, locally provable runtime/Python compatibility issues, and actual hook wiring. It does not contact a release service, so remote update availability remains outside its authority.

Bundle artifact paths and rollback runtime targets must not be symlinks. The manager checks the marker and original manifest digest when reusing a retained runtime, but it does not rehash every previously extracted file. Protect `~/.local/share/codex-radar/runtime` as same-user trusted state.

## 한국어

이 runbook은 호스트 로컬 Codex Radar helper를 사용자 수준 Codex lifecycle hook에 연결하는 절차입니다. Hook 설정은 항상 사용자가 명시적으로 수행합니다. Helper installer와 VS Code 확장은 `~/.codex/hooks.json`을 수정하지 않습니다.

### 요구 사항

- Python 3.9 이상을 사용할 수 있는 POSIX 호스트가 필요합니다.
- GitHub Release의 Codex Radar helper bundle 또는 개발용 source 설치가 필요합니다.
- Hook payload와 session transcript에 민감한 로컬 데이터가 포함될 수 있음을 이해해야 합니다.

### Release Helper Bundle 설치

의도한 GitHub Release/account에서 신뢰할 수 있는 TLS 연결로 bundle, checksum, release note를 받습니다. 함께 제공되는 `.sha256`은 bundle 무결성을 검증하지만 게시자 authenticity를 증명하지는 않습니다. 손상된 bundle과 함께 제공된 checksum만으로는 출처를 신뢰할 수 없습니다. Standalone `install-helper.py`도 bootstrap code이므로 같은 trusted release에서 받아야 합니다.

다운로드한 `codex-radar-helper-<version>.zip`을 검증한 다음 압축을 풉니다. 지원되는 Linux/Remote SSH 경로에서는 다음 명령을 사용합니다.

```bash
sha256sum --check codex-radar-helper-<version>.zip.sha256
unzip codex-radar-helper-<version>.zip
cd codex-radar-helper-<version>
```

압축을 푼 디렉터리에서 다음 명령을 실행합니다.

```bash
python3 install-helper.py install .
```

Installer는 `helper-manifest.json`으로 모든 bundle artifact를 검증하고, pure-Python wheel을 변경 불가능한 version runtime에 추출한 다음 아래 `current` symlink를 원자적으로 전환합니다.

```text
~/.local/share/codex-radar/runtime/current
```

`~/.local/bin` 아래에는 다음 hook command를 포함한 안정적인 사용자 수준 symlink가 생성됩니다.

```text
~/.local/bin/codex-radar-hook
```

Installer는 Codex 설정을 수정하지 않습니다. 관리 대상 command 이름과 같은 non-symlink 파일이 `~/.local/bin`에 이미 있으면 덮어쓰지 않고 설치를 중단합니다.

설치된 runtime과 보존된 runtime을 확인합니다.

```bash
~/.local/bin/codex-radar-helper status
```

선택된 runtime, stable shim, 로컬 Python 호환성, 실제 hook 연결 상태를 읽기 전용으로 점검합니다.

```bash
~/.local/bin/codex-radar-helper diagnose
```

JSON 결과는 로컬 경로를 포함하지 않는 상태 코드를 사용합니다. 확장 호환성은 설치된 helper가 선언한 범위만 확인하며 새 release 존재 여부는 판정하지 않습니다. 기본값이 아닌 hook 설정을 점검할 때만 `--hooks-file PATH`를 사용합니다.

Upgrade 후 이전 runtime으로 원자적으로 rollback합니다.

```bash
~/.local/bin/codex-radar-helper rollback
```

보존된 특정 version을 직접 선택할 수도 있습니다.

```bash
~/.local/bin/codex-radar-helper rollback <runtime-version>
```

### 개발용 Source 설치

공개 베타 migration 기간에는 기존 `codex-radar hook` command도 계속 호환됩니다. Source checkout은 같은 전용 `codex-radar-hook` entrypoint를 설치합니다.

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e .
codex-radar-hook --help
```

Source checkout command는 안정적인 release hook 경로가 아닙니다. Checkout과 무관한 고정 shim이 필요하면 helper bundle을 사용해야 합니다.

### 정확한 Hook 설정 Preview

현재 사용자의 절대 hook shim 경로가 포함된 전체 fragment를 출력합니다.

```bash
~/.local/bin/codex-radar-helper hook-config
```

기존 파일과의 unified diff를 파일 수정 없이 확인합니다.

```bash
~/.local/bin/codex-radar-helper hook-config --hooks-file ~/.codex/hooks.json
```

출력을 검토한 다음 제안된 `hooks` entry를 `~/.codex/hooks.json`에 직접 merge합니다. 관련 없는 hook은 유지해야 합니다. [`examples/hooks.json`](../../examples/hooks.json)은 정확한 event shape를 보여주지만, `/home/YOUR_USER` placeholder는 `hook-config`가 출력한 절대 경로로 바꿔야 합니다.

관리 대상 event는 `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`입니다. 모두 같은 고정 절대 경로의 `codex-radar-hook` shim을 5초 timeout으로 호출합니다.

### 신뢰 및 검증

Codex를 시작하거나 resume합니다. Codex가 hook 검토를 요청하면 `/hooks`에서 내용을 확인하고 신뢰하도록 설정합니다. 짧은 turn을 실행한 다음 확인합니다.

```bash
~/.local/bin/codex-radar sessions
~/.local/bin/codex-radar doctor
~/.local/bin/codex-radar path
```

### Hook 연결 비활성화 또는 제거

`~/.codex/hooks.json`에서 Codex Radar entry만 제거하고 관련 없는 hook은 유지합니다. 이 작업은 Radar state나 보존된 helper runtime을 삭제하지 않고 새 lifecycle update만 중단합니다.

안정적인 symlink 또는 runtime directory 제거는 별도의 수동 cleanup 작업입니다. Manager는 install, upgrade, rollback, cleanup 중에 hook 설정을 변경하지 않습니다.

`codex-radar-helper diagnose`는 누락되거나 다른 대상을 가리키는 stable shim, 로컬에서 입증 가능한 runtime/Python 호환성 문제, 실제 hook 연결 상태를 탐지합니다. Release service에는 접속하지 않으므로 원격 update 존재 여부는 판정 범위 밖입니다.

Bundle artifact path와 rollback runtime target은 symlink일 수 없습니다. Manager는 보존된 runtime을 다시 사용할 때 marker와 원래 manifest digest를 확인하지만, 이전에 추출된 모든 파일을 다시 hash하지는 않습니다. `~/.local/share/codex-radar/runtime`은 동일 사용자만 신뢰할 수 있는 state로 보호해야 합니다.
