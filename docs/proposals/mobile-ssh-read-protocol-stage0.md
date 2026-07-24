# Mobile SSH Read Protocol Stage 0

## Decision

Stage 0 uses a foreground, read-only JSONL process launched through an existing SSH session. It does not open a network listener, run as a daemon, create an Android product surface, or add remote write authority.

The repository spike is intentionally non-packaged:

```bash
PYTHONPATH=src python3 scripts/read-protocol-stage0.py
```

It evaluates transport semantics around the shipped sanitized contracts without changing the helper or VSIX candidate.

## Ownership and Trust Boundary

- The SSH client owns connection, authentication, process lifetime, reconnect, and host selection.
- The host-local process owns reads from the existing Radar state and Codex transcript stores.
- `codex-radar.display-state` v1 remains the list/state payload.
- Explicit bounded preview requests reuse negotiated `codex-radar.transcript-preview` v1 or v2.
- Raw `cwd`, transcript paths, raw transcript payloads, HTML, client-local read state, and write actions never become protocol fields.
- stdout is JSONL protocol only. Operational diagnostics use stable codes on stderr and never include private paths or raw request values.

## Protocol

Every request has an integer or string `id`, a `method`, and optional object `params`. Every response echoes `id` and contains either `result` or `error.code`. Event messages contain `event` and `params` without a request id.

The client must first negotiate:

```json
{"id":1,"method":"initialize","params":{"protocol_versions":[1],"preview_contract_versions":[1,2]}}
```

Stage 0 methods:

- `initialize`: negotiates protocol v1 and the highest mutually supported preview contract.
- `state/read`: returns the existing sanitized display-state v1 object.
- `preview/read`: accepts `session_id`, explicit `limit` from 1 through 200, and optionally the already-negotiated preview version.
- `attention/poll`: establishes a baseline on its first call, then emits foreground `attention` events for a new `waiting_approval` state or a `running`/`tool_running` to `done` transition observed on later calls.
- `shutdown`: acknowledges and ends the foreground process.

Unknown methods, malformed requests, unsupported versions, unavailable state, and preview lookup failures return stable error codes. They do not echo unsafe input.

## Foreground Events and Reconnect

Attention delivery is deliberately foreground and polling-based in Stage 0. There is no background delivery guarantee.

- The first `attention/poll` after `initialize` records a baseline and emits no historical event.
- Later polls emit transition events with sanitized session id, project, current status, previous status, and a connection-local sequence.
- EOF or SSH disconnect ends the process.
- Reconnect starts a new process, repeats `initialize`, reads current state, and establishes a new attention baseline.
- A future client can reconcile the full current state after reconnect, but Stage 0 does not promise replay of events that occurred while disconnected.

This avoids inventing shared cursors, durable notification queues, or cross-client read state before a concrete mobile product is approved.

## Validation

Run:

```bash
PYTHONPATH=src python3 -m unittest tests.test_read_protocol_stage0
PYTHONPATH=src python3 scripts/smoke-read-protocol-stage0.py
```

The unit tests cover negotiation, state/preview contract reuse, attention transitions, fresh reconnect baselines, stdout purity, stable errors, and fail-closed contract handling. The disposable subprocess smoke performs initialize, state, bounded preview, shutdown, then repeats the sequence in a new process to prove reconnect behavior without a listener.

## Exit and Non-Goals

Stage 0 is complete when the proposal, tests, and loopback smoke pass. It does not authorize:

- Android UI or product activation;
- background push or OS notifications;
- a network listener, daemon, or proxy;
- thread resume/send/archive or any other write action;
- shared read/unread state;
- multi-host aggregation;
- a production support promise or publication.
