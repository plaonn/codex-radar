# Android A3.0F mwiede/jsch compatibility result

## Disposition

The bounded fallback experiment passes on an Android API 36 emulator against
disposable loopback-only POSIX `sshd` instances. It proves a broader safe
host-key boundary than the accepted SSHJ experiment:

- RSA host keys pass.
- `ecdsa-sha2-nistp256` host keys pass.
- `ssh-ed25519` was attempted and failed before the host-key repository.

The recommendation is to adopt `mwiede/jsch` for the separate A3.1 production
implementation, subject to explicit parent disposition. This experiment does
not wire a production transport, select a public support commitment, implement
A4, or authorize merge to `main`.

## Host-key matrix

| Attempted family | Result | Exact boundary |
| --- | --- | --- |
| RSA (`rsa-sha2-*` negotiation) | Passed | Explicit review, exact algorithm + SHA-256 pin, Keystore authentication, reconnect, mismatch hard failure |
| `ecdsa-sha2-nistp256` | Passed | Same full boundary as RSA; no provider install, mutation, or fallback |
| `ssh-ed25519` | Failed before verifier | Android receives the base multi-release-JAR implementation whose Ed25519 verifier requires Java 15 replacement classes or Bouncy Castle; no pin or authentication was attempted |

Ed25519 was not enabled by adding Bouncy Castle. ECDSA already satisfies the
required modern non-RSA family with the platform provider, while adding a
provider only for a third family would enlarge packaging and provider
complexity without changing this experiment's recommendation.

## Proved boundary

- The app generates one EC P-256 key per immutable profile id in
  `AndroidKeyStore`; the private key has no encoded form.
- A custom JSch `Identity` signs through
  `Signature("SHA256withECDSA").initSign(AndroidKeyStore PrivateKey)`. It never
  receives, exports, imports, serializes, or stores private-key bytes.
- The only exported identity material is the OpenSSH public-key blob.
- A memory-only `HostKeyRepository` captures algorithm and SHA-256 fingerprint.
  `StrictHostKeyChecking=yes` rejects unknown and changed keys during key
  exchange, before public-key authentication.
- Exact pinned reconnects succeed. A changed algorithm or SHA-256 fingerprint
  returns the stable `host_key_mismatch` failure.
- The command channel has `setPty(false)` and requests exactly
  `codex-radar mobile rpc`. The disposable server forced-command guard observed
  that exact original command and an empty `SSH_TTY`.
- The isolated packaged helper `0.4.12` read only synthetic state.
  `initialize` and `state/read` crossed the 1 MiB-bounded JSONL boundary and
  reused the accepted A2 domain parser.
- Stderr draining starts before channel connect/exec, discards content, and
  closes the session at its byte cap. No raw diagnostic is returned or logged.
- Remote shutdown/EOF, explicit background close, and a forced SSH transport
  loss close protocol, channel, and session ownership idempotently.
- Outbound and inbound `MAX` frames pass; `MAX + 1`, malformed JSON,
  duplicate/unexpected ids, and incompatible versions poison the connection
  before partial state application.
- User-visible failures are stable path-free codes. Host, port, username,
  fingerprint, raw protocol, stderr, exception text, preview content, private
  paths, and temporary materials are absent from retained evidence.

## Dependency, license, and security review

Fresh upstream evidence observed on 2026-07-26 selected
`com.github.mwiede:jsch:2.28.5`:

- Maven Central metadata listed `2.28.5` as the newest release, published
  2026-07-23.
- The matching GitHub release is tagged `jsch-2.28.5` at commit `eb011bc`.
- The Maven POM and bundled notices declare Revised BSD for JSch/JZlib and ISC
  for the bundled jBCrypt code.
- Android `debugRuntimeClasspath` resolves JSch itself with no JSch transitive
  runtime dependency. Kotlin stdlib remains the pre-existing app dependency.
- The built debug APK is approximately 2.23 MB. The accepted SSHJ experiment
  resolved SSHJ, SLF4J API, asn-one, and three Bouncy Castle modules.
- The upstream repository publishes releases and CI/CodeQL updates, but has no
  `SECURITY.md` and showed no published GitHub security advisories at review
  time. Absence of advisories is evidence, not a guarantee of no vulnerability.

No Bouncy Castle provider is installed, inserted, selected globally, or
packaged by the fallback spike. RSA and ECDSA use Android's platform JCA
providers. The Ed25519 limitation is reported rather than bypassed.

## SSHJ comparison

| Axis | SSHJ `0.40.0` | mwiede/jsch `2.28.5` |
| --- | --- | --- |
| Keystore EC identity | Passed for RSA-host server | Passed for RSA and ECDSA-host servers |
| Host-key coverage observed on API 36 | RSA passed; ECDSA and Ed25519 failed before verifier | RSA and ECDSA passed; Ed25519 failed before verifier |
| Exact trust ceremony | Passed | Passed |
| Runtime dependency footprint | Six resolved SSH-related/crypto components | One JSch component |
| Provider handling | Required disabling forced BC selection and constraining KEX | Platform JCA for proved matrix; no provider mutation |
| Lifecycle/protocol complexity | Custom adapter and listeners | Custom Identity, repository, channel monitor; comparable bounded ownership |
| License | Apache-2.0 plus MIT/Apache/Bouncy Castle dependencies | Revised BSD plus bundled Revised BSD/ISC notices |

The recommendation favors `mwiede/jsch`: it preserves every accepted safety
contract, proves ECDSA host-key compatibility without host reconfiguration or
provider mutation, and has the smaller resolved runtime footprint. The
remaining Ed25519 limitation should be documented in A3.1 rather than weakened
or hidden.

## Reproducible verification

The public-safe runner is `apps/android/tools/run_a3f_smoke.py`. It:

1. obtains only the app-generated OpenSSH public key from the emulator;
2. installs helper `0.4.12` into a disposable virtual environment;
3. creates synthetic Radar/Codex homes;
4. starts separate loopback user-mode `sshd` fixtures for RSA, ECDSA P-256,
   and Ed25519 host keys;
5. runs the focused instrumentation boundary, including a forced transport
   loss for each passing family;
6. emits only the checked-in sanitized scenario manifest; and
7. removes the virtual environment, keys, configs, logs, state, markers,
   processes, and ports through bounded cleanup.

Verification completed:

- Android JVM unit tests, lint, debug assembly, and Android-test assembly.
- Focused API 36 emulator/loopback matrix.
- Full connected Android instrumentation without host arguments.
- Fixture drift and Android privacy-negative checks.
- Repository Python unit suite and compileall.

The retained manifest is
`docs/experiments/android-a3f-jsch-smoke-result.json`.
