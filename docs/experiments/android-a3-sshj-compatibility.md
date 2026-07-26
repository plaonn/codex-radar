# Android A3.0 SSHJ compatibility result

## Disposition

The bounded A3.0 experiment passes on an Android API 36 emulator against a
disposable loopback-only POSIX `sshd`, with one explicit compatibility
constraint:

- SSHJ `0.40.0` can authenticate with an app-generated, non-exportable Android
  Keystore EC P-256 key when `DefaultSecurityProviderConfig` leaves provider
  selection to Android and the key-exchange list is limited to ECDH P-256.
- The tested host used an RSA host key. With forced Bouncy Castle selection
  disabled, SSHJ hard-codes `KeyFactory("ECDSA")` while parsing ECDSA host keys;
  Android exposes `KeyFactory("EC")`, so an ECDSA host key fails before the
  verifier. Ed25519 also failed before verification in this configuration.

This is not A3.1 adoption. The production fixture cockpit remains unchanged.
Before A3.1, design must either accept an explicitly documented RSA-host-key
compatibility boundary or ask for a fallback-library comparison that preserves
the same Keystore and exact-pin contracts.

## Proved boundary

- A per-profile `AndroidKeyStore` key is EC P-256, implements `ECKey`, and has
  no encoded private-key material.
- An unknown host key is captured for explicit SHA-256 fingerprint review and
  rejected before authentication.
- An exact algorithm and fingerprint pin reconnects; a changed pin hard-fails
  before authentication with `host_key_mismatch`.
- SSHJ authenticates using the Keystore-owned private key without export,
  import, password, keyboard-interactive authentication, or software-key
  storage.
- A command channel executes exactly `codex-radar mobile rpc`. The disposable
  host forced-command guard observed two exact commands, no PTY for either, and
  both helper processes exited after background/close.
- The helper was an isolated install of runtime `0.4.12` using disposable,
  synthetic Radar state. `initialize` and `state/read` crossed the bounded
  JSONL session and reused the accepted A2 domain parser.
- A fresh reconnect starts a new SSH process and protocol baseline. No replay
  path exists in the spike.
- Outbound and inbound frames accept `MAX` and reject `MAX + 1` before writing
  or parsing. Malformed JSON, duplicate response ids, unexpected ids, and
  incompatible protocol versions poison the connection.
- User-visible transport failures are stable codes. No exception message,
  remote stderr, request, preview, credential, fingerprint, or host value is
  persisted or logged by the app; the review fingerprint exists in memory only.

## Dependency and provider review

Resolved runtime dependencies:

| Component | Version | License | Role |
| --- | --- | --- | --- |
| SSHJ | 0.40.0 | Apache-2.0 | SSH transport |
| SLF4J API | 2.0.17 | MIT | SSHJ logging API |
| asn-one | 0.6.0 | Apache-2.0 | SSH encoding |
| bcprov | 1.80.2 | Bouncy Castle license | SSHJ transitive crypto |
| bcpkix | 1.80.2 | Bouncy Castle license | aligned SSHJ transitive crypto |
| bcutil | 1.80.2 | Bouncy Castle license | SSHJ transitive crypto |

`bcpkix` is pinned to `1.80.2` so the three Bouncy Castle modules resolve to
one patch level. The duplicate Java 9 OSGi manifest resource is excluded from
APK packaging; executable classes and license resources are not excluded.

The spike never installs or selects Bouncy Castle as the global provider.
`DefaultSecurityProviderConfig` must leave `SecurityUtils` without a pinned
provider or the connection fails closed as `provider_conflict`. This lets JCA
route `SHA256withECDSA` signing to the provider that owns the non-exportable
Keystore key. No SLF4J implementation is packaged, so SSHJ uses its NOP logger;
adding a logger binding requires a privacy re-review because verifier failures
can include host details.

## Verification

- Android JVM unit suite: passed.
- Android lint, debug assembly, and Android-test compilation: passed.
- Emulator instrumentation: 10 tests passed, including the real SSHJ/Keystore
  smoke and the existing A2 fixture cockpit UI test.
- Repository Python unit suite and compileall: passed.
- Fixture drift and Android privacy-negative checks: passed.
- Disposable app/test packages, SSH host, host keys, public-key authorization,
  synthetic state, and helper environment are removed after verification.

The experiment does not claim production transport, physical-device support,
background execution, publication, imported credentials, remote writes, A3.1,
or A4.
