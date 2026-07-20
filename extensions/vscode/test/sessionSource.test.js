const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  classifiedProject,
  defaultStateDir,
  filterSessionsByStatus,
  groupSessionsByProject,
  inspectSessionCache,
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

test("classifies Codex memory maintenance outside ordinary project groups", () => {
  const options = {
    env: { CODEX_HOME: "/tmp/codex-home" },
    homeDir: "/tmp/home",
    platform: "linux",
  };

  assert.equal(
    classifiedProject({ cwd: "/tmp/codex-home/memories", project: "memories" }, options),
    "Codex internal",
  );
  assert.equal(
    classifiedProject({ cwd: "/tmp/project", project: "project" }, options),
    "project",
  );
  assert.equal(
    classifiedProject(
      { cwd: "C:\\Users\\dev\\.codex\\memories\\maintenance", project: "maintenance" },
      { env: {}, homeDir: "C:\\Users\\dev", platform: "win32" },
    ),
    "Codex internal",
  );
});

test("normalizes cached Codex memory sessions without rewriting the cache", () => {
  const sessions = sessionsFromPayload({
    schema_version: 1,
    sessions: {
      internal: {
        session_id: "internal",
        cwd: "/tmp/codex-home/memories/maintenance",
        project: "memories",
        status: "done",
      },
    },
  }, {
    env: { CODEX_HOME: "/tmp/codex-home" },
    homeDir: "/tmp/home",
    platform: "linux",
  });

  assert.equal(sessions[0].project, "Codex internal");
});

test("does not add an empty project field to legacy cache rows", () => {
  const sessions = sessionsFromPayload({
    schema_version: 1,
    sessions: { legacy: { session_id: "legacy", status: "done" } },
  });

  assert.equal(Object.prototype.hasOwnProperty.call(sessions[0], "project"), false);
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

test("diagnoses missing state directory without creating it", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-vscode-"));
  const missingState = path.join(tmp, "missing-state");
  try {
    const diagnostic = inspectSessionCache(missingState);

    assert.equal(diagnostic.code, "missing-state-dir");
    assert.equal(diagnostic.canLoad, false);
    assert.match(diagnostic.action, /codex-radar-helper diagnose/);
    assert.equal(fs.existsSync(missingState), false);
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }
});

test("keeps inaccessible state diagnostics path-free", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-vscode-private-"));
  const privateState = path.join(tmp, "private-state");
  const originalStatSync = fs.statSync;
  fs.statSync = (candidate, ...args) => {
    if (path.resolve(candidate) === path.resolve(privateState)) {
      const error = new Error(`${privateState} is private`);
      error.code = "EACCES";
      throw error;
    }
    return originalStatSync(candidate, ...args);
  };
  try {
    const diagnostic = inspectSessionCache(privateState);

    assert.equal(diagnostic.code, "state-dir-unavailable");
    assert.equal(JSON.stringify(diagnostic).includes("private-state is private"), false);
    assert.equal(diagnostic.detail, "The extension host could not inspect the configured Radar state directory.");
  } finally {
    fs.statSync = originalStatSync;
    fs.rmSync(tmp, { force: true, recursive: true });
  }
});

test("diagnoses missing session index inside existing state directory", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-vscode-"));
  try {
    const diagnostic = inspectSessionCache(tmp);

    assert.equal(diagnostic.code, "missing-session-index");
    assert.equal(diagnostic.canLoad, false);
    assert.match(diagnostic.action, /codex-radar-helper diagnose/);
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }
});

test("diagnoses an empty session index", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-vscode-"));
  try {
    fs.writeFileSync(path.join(tmp, "sessions.json"), JSON.stringify({
      schema_version: 1,
      sessions: {},
    }), "utf8");

    const diagnostic = inspectSessionCache(tmp);

    assert.equal(diagnostic.code, "empty-session-index");
    assert.equal(diagnostic.canLoad, true);
    assert.equal(diagnostic.sessionsCount, 0);
    assert.match(diagnostic.action, /before treating this as a hook issue/);
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }
});

test("diagnoses a stale session index without hiding sessions", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-vscode-"));
  try {
    fs.writeFileSync(path.join(tmp, "sessions.json"), JSON.stringify({
      schema_version: 1,
      sessions: {
        "session-1": {
          session_id: "session-1",
          status: "running",
          last_seen_at: "2026-07-04T00:00:00+00:00",
        },
      },
    }), "utf8");

    const diagnostic = inspectSessionCache(tmp, {
      nowMs: Date.parse("2026-07-04T00:31:00+00:00"),
      recentAfterMs: 30 * 60 * 1000,
    });

    assert.equal(diagnostic.code, "stale-session-index");
    assert.equal(diagnostic.canLoad, true);
    assert.equal(diagnostic.sessionsCount, 1);
    assert.match(diagnostic.action, /codex-radar-helper diagnose/);
    assert.deepEqual(loadSessionCache(tmp).map((session) => session.session_id), ["session-1"]);
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }
});

test("diagnoses a ready session index", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-vscode-"));
  try {
    fs.writeFileSync(path.join(tmp, "sessions.json"), JSON.stringify({
      schema_version: 1,
      sessions: {
        "session-1": {
          session_id: "session-1",
          status: "running",
          last_seen_at: "2026-07-04T00:29:00+00:00",
        },
      },
    }), "utf8");

    const diagnostic = inspectSessionCache(tmp, {
      nowMs: Date.parse("2026-07-04T00:31:00+00:00"),
      recentAfterMs: 30 * 60 * 1000,
    });

    assert.equal(diagnostic.code, "ready");
    assert.equal(diagnostic.canLoad, true);
    assert.equal(diagnostic.sessionsCount, 1);
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
  assert.equal(
    defaultStateDir({ CODEX_RADAR_HOME: "~/radar" }, "/home/test", "linux"),
    path.posix.resolve("/home/test/radar"),
  );
  assert.equal(
    defaultStateDir({ XDG_STATE_HOME: "~/state" }, "/home/test", "linux"),
    path.posix.join(path.posix.resolve("/home/test/state"), "codex-radar"),
  );
  assert.equal(
    defaultStateDir({}, "/home/test", "linux"),
    path.posix.join("/home/test", ".local", "state", "codex-radar"),
  );
  assert.equal(
    defaultStateDir(
      { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
      "C:\\Users\\test",
      "win32",
    ),
    path.win32.join("C:\\Users\\test\\AppData\\Local", "codex-radar", "state"),
  );
  assert.equal(
    defaultStateDir({}, "C:\\Users\\test", "win32"),
    path.win32.join("C:\\Users\\test", "AppData", "Local", "codex-radar", "state"),
  );
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
