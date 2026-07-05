const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  defaultStateDir,
  filterSessionsByStatus,
  groupSessionsByProject,
  loadSessionCache,
  normalizeStatusFilter,
  sessionDisplayStatus,
  sessionsFromPayload,
} = require("../src/sessionSource");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const examplePath = path.join(repoRoot, "examples", "sessions.json");

test("loads sessions.json fixture in last_seen_at descending order", () => {
  const sessions = loadSessionCache(path.dirname(examplePath));

  assert.deepEqual(
    sessions.map((session) => session.session_id),
    ["session-approval", "session-running"],
  );
  assert.equal(sessions[0].display_status, "waiting_approval");
});

test("groups sessions by project without changing recent project order", () => {
  const groups = groupSessionsByProject(loadSessionCache(path.dirname(examplePath)));

  assert.deepEqual(
    groups.map((group) => [group.project, group.sessions.length]),
    [
      ["project-a", 1],
      ["project-b", 1],
    ],
  );
});

test("keeps lifecycle status as display status", () => {
  const nowMs = Date.parse("2026-07-04T00:40:01+00:00");

  assert.equal(
    sessionDisplayStatus(
      { status: "running", last_seen_at: "2026-07-04T00:00:00+00:00" },
      { nowMs },
    ),
    "running",
  );
  assert.equal(
    sessionDisplayStatus(
      { status: "waiting_approval", last_seen_at: "2026-07-04T00:00:00+00:00" },
      { nowMs },
    ),
    "waiting_approval",
  );
});

test("missing state directory returns no sessions without creating it", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-vscode-"));
  const missingState = path.join(tmp, "missing-state");
  try {
    assert.deepEqual(loadSessionCache(missingState), []);
    assert.equal(fs.existsSync(missingState), false);
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }
});

test("rejects unknown schema versions", () => {
  const sessions = sessionsFromPayload({
    schema_version: 999,
    sessions: {
      "session-1": {
        session_id: "session-1",
        status: "done",
      },
    },
  });

  assert.deepEqual(sessions, []);
});

test("resolves state directory like codex-radar core", () => {
  assert.equal(defaultStateDir({ CODEX_RADAR_HOME: "~/radar" }, "/home/test"), "/home/test/radar");
  assert.equal(
    defaultStateDir({ XDG_STATE_HOME: "~/state" }, "/home/test"),
    "/home/test/state/codex-radar",
  );
  assert.equal(defaultStateDir({}, "/home/test"), "/home/test/.local/state/codex-radar");
});

test("filters sessions by display status", () => {
  const sessions = [
    { session_id: "approval", display_status: "waiting_approval", is_attention: true },
    { session_id: "running", display_status: "running", is_attention: false },
    { session_id: "done", display_status: "done", is_attention: false },
  ];

  assert.equal(normalizeStatusFilter("all"), "");
  assert.equal(normalizeStatusFilter(""), "");
  assert.deepEqual(filterSessionsByStatus(sessions, "all"), sessions);
  assert.deepEqual(
    filterSessionsByStatus(sessions, "waiting_approval").map((session) => session.session_id),
    ["approval"],
  );
  assert.deepEqual(
    filterSessionsByStatus(sessions, "attention").map((session) => session.session_id),
    ["approval"],
  );
});
