const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  ExportSourceError,
  loadExportPreview,
  loadSessionState,
  semanticParity,
  sessionsFromDisplayState,
  validateDisplayState,
} = require("../src/exportSource");

const fixtureRoot = path.resolve(__dirname, "..", "..", "..", "tests", "fixtures");

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), "utf8"));
}

function directPayloadFromExport(payload, fields = {}) {
  return {
    schema_version: 1,
    sessions: Object.fromEntries(payload.sessions.map((session) => [
      session.session_id,
      {
        ...Object.fromEntries(Object.entries(session).filter(([key]) => ![
          "archive_state",
          "requires_attention",
          "display_status",
        ].includes(key))),
        ...fields[session.session_id],
      },
    ])),
  };
}

function writeDirectState(root, payload) {
  const stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir);
  fs.writeFileSync(path.join(stateDir, "sessions.json"), JSON.stringify(payload));
  return stateDir;
}

test("accepts the golden display-state contract and preserves direct action metadata only during adaptation", () => {
  const payload = validateDisplayState(fixture("display-state-v1.json"));
  const direct = [{
    session_id: "waiting-1",
    cwd: "/trusted/worktree",
    transcript_path: "/trusted/rollout.jsonl",
    title: "private direct title",
    last_assistant_message: "private direct summary",
    raw: "/must/not/cross",
  }];
  const sessions = sessionsFromDisplayState(payload, direct);
  const waiting = sessions.find((session) => session.session_id === "waiting-1");

  assert.equal(waiting.cwd, "/trusted/worktree");
  assert.equal(waiting.transcript_path, "/trusted/rollout.jsonl");
  assert.equal(Object.prototype.hasOwnProperty.call(waiting, "raw"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(waiting, "title"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(waiting, "last_assistant_message"), false);
  assert.equal(waiting.archive_state, "active");
  assert.equal(waiting.read_source, "export");
  assert.equal(JSON.stringify(payload).includes("cwd"), false);
});

test("fails closed on schema code, identity, label, timestamp, and uniqueness drift", () => {
  const cases = [
    (payload) => { payload.source.reason = "Bad reason"; },
    (payload) => { payload.usage.reason = "/private/reason"; },
    (payload) => { payload.usage.plan_type = "Pro Plan"; },
    (payload) => { payload.sessions[0].session_id = "../private"; },
    (payload) => { payload.sessions[0].project = "/private/repo"; },
    (payload) => { payload.sessions[0].model = "<script>"; },
    (payload) => { payload.sessions[1].current_tool = "private\\tool"; },
    (payload) => { payload.sessions[0].last_seen_at = "2026-07-14T00:00:00"; },
    (payload) => { payload.capabilities.push(payload.capabilities[0]); },
  ];

  for (const mutate of cases) {
    const payload = fixture("display-state-v1.json");
    mutate(payload);
    assert.throws(
      () => validateDisplayState(payload),
      (error) => error instanceof ExportSourceError && error.code === "display_state_schema_mismatch",
    );
  }
});

test("rejects display-state schema drift and private path fields", () => {
  const payload = fixture("display-state-v1.json");
  payload.sessions[0].cwd = "/private/repo";

  assert.throws(
    () => validateDisplayState(payload),
    (error) => error instanceof ExportSourceError && error.code === "display_state_schema_mismatch",
  );
});

test("golden export sessions have semantic parity with the direct session adapter", () => {
  const payload = fixture("display-state-v1.json");
  const direct = Object.values(directPayloadFromExport(payload).sessions);

  assert.equal(semanticParity(direct, payload), true);
  assert.equal(semanticParity(direct.slice(1), payload), false);
});

test("export mode uses shared state and keeps direct cwd for trusted handoff", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-export-source-"));
  try {
    const payload = fixture("display-state-v1.json");
    const stateDir = writeDirectState(root, directPayloadFromExport(payload, {
      "waiting-1": { cwd: "/trusted/worktree" },
    }));
    let observedArgs = null;
    const result = await loadSessionState(stateDir, {
      mode: "export",
      commandRunner: async (args) => {
        observedArgs = args;
        return JSON.stringify(payload);
      },
    });

    assert.deepEqual(observedArgs, ["--state-dir", stateDir, "export", "state", "--json"]);
    assert.equal(result.diagnostic.readSource, "export");
    assert.equal(result.diagnostic.exportSourceStatus, "ready");
    assert.equal(result.sessions.find((session) => session.session_id === "waiting-1").cwd, "/trusted/worktree");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("export failure falls back to direct sessions with safe source diagnostics", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-export-fallback-"));
  try {
    const stateDir = writeDirectState(root, {
      schema_version: 1,
      sessions: {
        "session-1": {
          session_id: "session-1",
          status: "done",
          last_seen_at: "2026-07-14T00:00:00+00:00",
        },
      },
    });
    const result = await loadSessionState(stateDir, {
      mode: "export",
      commandRunner: async () => {
        const error = new Error("/private/helper/path failed");
        error.code = "ENOENT";
        throw error;
      },
    });

    assert.equal(result.sessions.length, 1);
    assert.equal(result.diagnostic.readSource, "direct-fallback");
    assert.equal(result.diagnostic.fallbackReason, "export_command_unavailable");
    assert.equal(JSON.stringify(result.diagnostic).includes("/private/helper/path"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("observe mode keeps direct as effective source and records parity", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-export-observe-"));
  try {
    const payload = fixture("display-state-v1.json");
    const stateDir = writeDirectState(root, directPayloadFromExport(payload));
    const result = await loadSessionState(stateDir, {
      mode: "observe",
      commandRunner: async () => JSON.stringify(payload),
      nowMs: Date.parse(payload.generated_at),
    });

    assert.equal(result.diagnostic.readSource, "direct");
    assert.equal(result.diagnostic.requestedSource, "observe");
    assert.equal(result.diagnostic.exportObservation, "matched");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("preview adapter invokes only the explicit bounded export command", async () => {
  const payload = fixture("transcript-preview-v1.json");
  let observedArgs = null;
  const result = await loadExportPreview("/state", "session-1", {
    limit: 2,
    commandRunner: async (args) => {
      observedArgs = args;
      return JSON.stringify(payload);
    },
  });

  assert.deepEqual(observedArgs, [
    "--state-dir",
    "/state",
    "export",
    "preview",
    "session-1",
    "--limit",
    "2",
  ]);
  assert.deepEqual(result.messages, payload.messages);
});
