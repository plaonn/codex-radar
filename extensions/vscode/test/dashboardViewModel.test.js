const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  baseDisplayStatus,
  buildDashboardModel,
  findSessionByKey,
  isArchivedSession,
  isUnresolvableDoneSession,
  normalizeSetupDiagnostic,
  sessionCard,
  statusOptions,
} = require("../src/dashboardViewModel");
const { catalogFromThreadLists } = require("../src/codexThreadCatalog");
const { decorateSessions, markDoneRead } = require("../src/readState");

const nowMs = Date.parse("2026-07-05T00:10:00+09:00");
const baseSessions = [
  {
    session_id: "approval-1",
    project: "project-a",
    display_status: "waiting_approval",
    last_seen_at: "2026-07-05T00:09:00+09:00",
    last_event_name: "PermissionRequest",
    last_assistant_message: "Need approval",
    model: "gpt-5",
  },
  {
    session_id: "done-1",
    project: "project-a",
    display_status: "done",
    last_seen_at: "2026-07-05T00:00:00+09:00",
    last_assistant_message: "token=secret_value finished",
  },
  {
    session_id: "archived-1",
    project: "project-b",
    display_status: "done",
    last_seen_at: "2026-07-05T00:01:00+09:00",
    last_assistant_message: "archived finished",
  },
];

function archiveResolver(session) {
  if (session.session_id === "done-1") {
    return { path: "/tmp/done.jsonl", source: "codex-store" };
  }
  return {
    path: session.session_id === "archived-1" ? "/tmp/archived.jsonl" : "",
    source: session.session_id === "archived-1" ? "archived" : "missing",
  };
}

function emptyArchiveResolver() {
  return { path: "", source: "missing" };
}

function activeTranscriptResolver() {
  return { path: "/tmp/rollout.jsonl", source: "codex-store" };
}

function archivedThreads() {
  return {
    ids: new Set(["archived-direct"]),
    rows: [{
      id: "archived-parent",
      cwd: "/repo",
      createdAt: Date.parse("2026-07-04T14:16:04Z") / 1000,
      updatedAt: Date.parse("2026-07-04T19:18:03Z") / 1000,
    }],
  };
}

test("builds a sanitized dashboard model with attention, projects, archived, and selection", () => {
  const sessions = decorateSessions(baseSessions, markDoneRead(new Set(), baseSessions[1]));
  const model = buildDashboardModel(sessions, {
    homeDir: "/Users/example",
    nowMs,
    resolveTranscriptPathInfo: archiveResolver,
  });

  assert.deepEqual(model.counts, {
    total: 3,
    visible: 2,
    filtered: 2,
    attention: 1,
    running: 0,
    archived: 1,
  });
  assert.equal(model.attention[0].sessionId, "approval-1");
  assert.equal(model.groups.length, 1);
  assert.equal(model.groups[0].project, "project-a");
  assert.equal(model.groups[0].sessions.length, 2);
  assert.equal(model.archived[0].sessionId, "archived-1");
  assert.equal(model.selected.sessionId, "approval-1");
  assert.equal(model.groups[0].sessions[1].snippet, "[REDACTED] finished");
});

test("adds transcript-derived title and speaker snippet fields to session cards", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-card-display-"));
  const transcriptPath = path.join(tmp, "session.jsonl");
  fs.writeFileSync(transcriptPath, [
    JSON.stringify({
      role: "user",
      content: [{ text: "## My request for Codex:\nReview the sidebar title model" }],
    }),
    JSON.stringify({ role: "assistant", content: [{ text: "Reading the relevant files." }] }),
    JSON.stringify({ role: "user", content: [{ text: "snippet은 마지막 user message로 가자" }] }),
  ].join("\n"), "utf8");

  const card = sessionCard({
    session_id: "display-1",
    project: "codex-radar",
    display_status: "running",
    last_seen_at: "2026-07-05T00:09:00+09:00",
    transcript_path: transcriptPath,
    last_assistant_message: "stale assistant cache",
  }, {
    nowMs,
    resolveTranscriptPathInfo: () => ({ path: transcriptPath, source: "explicit" }),
  });

  assert.equal(card.title, "Review the sidebar title model");
  assert.equal(card.snippetSpeaker, "You");
  assert.equal(card.snippetRole, "user");
  assert.equal(card.snippetText, "snippet은 마지막 user message로 가자");
});

test("uses app-server catalog title and archived ids without changing lifecycle status", () => {
  const catalog = catalogFromThreadLists({
    active: [{
      id: "display-1",
      title: "Official app-server title",
      cwd: "/repo",
      status: "notLoaded",
    }],
    archived: [{
      id: "archived-by-catalog",
      title: "Archived app-server title",
      cwd: "/repo",
      status: "notLoaded",
    }],
  });

  const card = sessionCard({
    session_id: "display-1",
    cwd: "/repo",
    project: "codex-radar",
    display_status: "running",
    last_seen_at: "2026-07-05T00:09:00+09:00",
    last_assistant_message: "cached snippet",
  }, {
    codexThreadCatalog: catalog,
    resolveTranscriptPathInfo: emptyArchiveResolver,
  });
  const archivedCard = sessionCard({
    session_id: "archived-by-catalog",
    cwd: "/repo",
    project: "codex-radar",
    display_status: "done",
    last_seen_at: "2026-07-05T00:08:00+09:00",
  }, {
    codexThreadCatalog: catalog,
    resolveTranscriptPathInfo: emptyArchiveResolver,
  });

  assert.equal(card.title, "Official app-server title");
  assert.equal(card.status, "running");
  assert.equal(archivedCard.title, "Archived app-server title");
  assert.equal(archivedCard.isArchived, true);
  assert.equal(archivedCard.status, "done");
});

test("filters project sessions by display status without changing attention count", () => {
  const sessions = decorateSessions(baseSessions, new Set(), new Set());
  const model = buildDashboardModel(sessions, {
    statusFilter: "done",
    nowMs,
    resolveTranscriptPathInfo: archiveResolver,
  });

  assert.equal(model.counts.filtered, 1);
  assert.equal(model.counts.attention, 2);
  assert.deepEqual(model.groups.map((group) => group.project), ["project-a"]);
});

test("hides unresolvable done sessions from active dashboard navigation", () => {
  const sessions = decorateSessions([
    {
      session_id: "orphan-done",
      project: "project-a",
      display_status: "done",
      last_seen_at: "2026-07-05T00:09:00+09:00",
    },
    {
      session_id: "active-done",
      project: "project-a",
      display_status: "done",
      last_seen_at: "2026-07-05T00:08:00+09:00",
    },
  ], new Set(), new Set());
  const model = buildDashboardModel(sessions, {
    resolveTranscriptPathInfo: (session) => (
      session.session_id === "active-done" ? { path: "/tmp/active.jsonl", source: "codex-store" } : emptyArchiveResolver()
    ),
    selectedIdentity: "orphan-done",
  });

  assert.equal(isUnresolvableDoneSession(sessions[0], {
    resolveTranscriptPathInfo: emptyArchiveResolver,
  }), true);
  assert.equal(isUnresolvableDoneSession(sessions[1], {
    resolveTranscriptPathInfo: () => ({ path: "/tmp/active.jsonl", source: "codex-store" }),
  }), false);
  assert.equal(model.counts.total, 2);
  assert.equal(model.counts.visible, 1);
  assert.equal(model.counts.attention, 1);
  assert.deepEqual(model.attention.map((card) => card.sessionId), ["active-done"]);
  assert.deepEqual(model.groups[0].sessions.map((card) => card.sessionId), ["active-done"]);
  assert.equal(model.selected.sessionId, "active-done");
});

test("pins current workspace projects only in sidebar project groups", () => {
  const sessions = decorateSessions([
    {
      session_id: "other-latest",
      cwd: "/work/other",
      project: "other",
      display_status: "done",
      last_seen_at: "2026-07-05T00:12:00+09:00",
    },
    {
      session_id: "current-older",
      cwd: "/work/codex-radar",
      project: "codex-radar",
      display_status: "done",
      last_seen_at: "2026-07-05T00:01:00+09:00",
    },
  ], new Set(), new Set());
  const model = buildDashboardModel(sessions, {
    workspaceFolders: ["/work/codex-radar"],
    resolveTranscriptPathInfo: activeTranscriptResolver,
  });

  assert.deepEqual(model.groups.map((group) => group.project), ["other", "codex-radar"]);
  assert.deepEqual(model.sidebarGroups.map((group) => group.project), ["codex-radar", "other"]);
  assert.equal(model.sidebarGroups[0].isCurrentWorkspace, true);
  assert.equal(model.sidebarGroups[1].isCurrentWorkspace, false);
});

test("orders multiple current workspace projects by workspace folder order", () => {
  const sessions = decorateSessions([
    {
      session_id: "second-newer",
      cwd: "/work/second",
      project: "second",
      display_status: "done",
      last_seen_at: "2026-07-05T00:12:00+09:00",
    },
    {
      session_id: "first-older",
      cwd: "/work/first/subdir",
      project: "first",
      display_status: "done",
      last_seen_at: "2026-07-05T00:01:00+09:00",
    },
  ], new Set(), new Set());
  const model = buildDashboardModel(sessions, {
    workspaceFolders: ["/work/first", "/work/second"],
    resolveTranscriptPathInfo: activeTranscriptResolver,
  });

  assert.deepEqual(model.sidebarGroups.map((group) => group.project), ["first", "second"]);
});

test("keeps non-attention sidebar projects stable despite running activity", () => {
  const sessions = decorateSessions([
    {
      session_id: "zeta-running-latest",
      cwd: "/work/zeta",
      project: "zeta",
      display_status: "running",
      last_seen_at: "2026-07-05T00:30:00+09:00",
    },
    {
      session_id: "alpha-running",
      cwd: "/work/alpha",
      project: "alpha",
      display_status: "running",
      last_seen_at: "2026-07-05T00:20:00+09:00",
    },
    {
      session_id: "middle-approval",
      cwd: "/work/middle",
      project: "middle",
      display_status: "waiting_approval",
      last_seen_at: "2026-07-05T00:01:00+09:00",
    },
  ], new Set(), new Set());
  const model = buildDashboardModel(sessions, {
    resolveTranscriptPathInfo: activeTranscriptResolver,
  });

  assert.deepEqual(model.groups.map((group) => group.project), ["zeta", "alpha", "middle"]);
  assert.deepEqual(model.sidebarGroups.map((group) => group.project), ["middle", "alpha", "zeta"]);
});

test("counts running and tool-running active sessions separately from attention", () => {
  const sessions = decorateSessions([
    { session_id: "running", project: "project-a", display_status: "running" },
    { session_id: "tool", project: "project-a", display_status: "tool_running" },
    { session_id: "done", project: "project-a", display_status: "done" },
  ], new Set(), new Set());
  const model = buildDashboardModel(sessions, {
    resolveTranscriptPathInfo: activeTranscriptResolver,
  });

  assert.equal(model.counts.running, 2);
  assert.equal(model.counts.attention, 1);
});

test("keeps selection on the same session identity when the row key changes", () => {
  const sessions = decorateSessions([
    {
      session_id: "other-1",
      project: "project-a",
      display_status: "waiting_approval",
      last_seen_at: "2026-07-05T00:12:00+09:00",
      last_event_name: "PermissionRequest",
      last_assistant_message: "Other attention thread",
    },
    {
      session_id: "selected-1",
      project: "project-a",
      display_status: "done",
      last_seen_at: "2026-07-05T00:11:00+09:00",
      last_assistant_message: "Updated selected thread",
    },
  ], new Set(), new Set());
  const model = buildDashboardModel(sessions, {
    selectedKey: "selected-1\n2026-07-05T00:01:00+09:00",
    selectedIdentity: "selected-1",
    nowMs,
    resolveTranscriptPathInfo: activeTranscriptResolver,
  });

  assert.equal(model.selected.sessionId, "selected-1");
  assert.equal(model.selected.key, "selected-1\n2026-07-05T00:11:00+09:00");
});

test("builds session action state for Webview buttons", () => {
  const unreadDone = decorateSessions([baseSessions[1]], new Set(), new Set())[0];
  const readDone = decorateSessions([baseSessions[1]], markDoneRead(new Set(), baseSessions[1]), new Set())[0];
  const archived = decorateSessions([baseSessions[2]], new Set(), new Set())[0];

  assert.equal(sessionCard(unreadDone).actions.canMarkRead, true);
  assert.equal(sessionCard(unreadDone).actions.canMarkUnread, false);
  assert.equal(sessionCard(readDone).actions.canMarkRead, false);
  assert.equal(sessionCard(readDone).actions.canMarkUnread, true);
  assert.equal(sessionCard(unreadDone, { resolveTranscriptPathInfo: activeTranscriptResolver }).actions.canOpen, true);
  assert.equal(sessionCard(unreadDone, { resolveTranscriptPathInfo: emptyArchiveResolver }).actions.canOpen, false);
  assert.equal(sessionCard(archived, { resolveTranscriptPathInfo: archiveResolver }).actions.canOpen, false);
  assert.equal(sessionCard(archived, { resolveTranscriptPathInfo: archiveResolver }).isArchived, true);
  assert.equal(sessionCard({ ...unreadDone, session_id: "unknown" }, { resolveTranscriptPathInfo: activeTranscriptResolver }).actions.canOpen, false);
});

test("keeps lifecycle display status and detects archived sessions separately", () => {
  const running = {
    session_id: "running-1",
    display_status: "tool_running",
    status: "tool_running",
    last_seen_at: "2026-07-04T23:00:00+09:00",
  };

  assert.equal(baseDisplayStatus(running), "tool_running");
  assert.equal(sessionCard(running, { nowMs }).status, "tool_running");
  assert.equal(isArchivedSession(baseSessions[2], { resolveTranscriptPathInfo: archiveResolver }), true);
});

test("detects archived sessions by direct Codex thread state without time-window guessing", () => {
  const archivedSession = {
    session_id: "archived-direct",
    cwd: "/repo",
    display_status: "done",
    last_seen_at: "2026-07-04T15:24:37Z",
    transcript_path: "",
  };
  const sideSessionNearArchivedThread = {
    ...archivedSession,
    session_id: "side-session",
  };

  assert.equal(isArchivedSession(archivedSession, {
    resolveTranscriptPathInfo: emptyArchiveResolver,
    resolveCodexArchivedThreads: archivedThreads,
  }), true);
  assert.equal(isArchivedSession(sideSessionNearArchivedThread, {
    resolveTranscriptPathInfo: emptyArchiveResolver,
    resolveCodexArchivedThreads: archivedThreads,
  }), false);
  assert.equal(isArchivedSession({ ...archivedSession, transcript_path: "/tmp/current.jsonl" }, {
    resolveTranscriptPathInfo: emptyArchiveResolver,
    resolveCodexArchivedThreads: archivedThreads,
  }), true);
});

test("finds sessions by timestamp state key", () => {
  const target = findSessionByKey(baseSessions, "done-1\n2026-07-05T00:00:00+09:00");

  assert.equal(target.session_id, "done-1");
  assert.equal(findSessionByKey(baseSessions, ""), null);
});

test("labels dashboard status options", () => {
  assert.deepEqual(statusOptions("attention").slice(0, 3), [
    { label: "All", value: "", isSelected: false },
    { label: "Needs review", value: "attention", isSelected: true },
    { label: "Active", value: "active", isSelected: false },
  ]);
});

test("carries session source setup diagnostics into empty dashboard models", () => {
  const model = buildDashboardModel([], {
    sessionSourceDiagnostic: {
      code: "missing-session-index",
      severity: "warning",
      title: "No Codex Radar session index yet",
      detail: "The state directory exists, but sessions.json has not been written.",
      action: "Verify the Codex lifecycle hook is configured.",
    },
  });

  assert.equal(model.emptyState, "No Codex Radar session index yet");
  assert.equal(model.setup.code, "missing-session-index");
  assert.equal(model.setup.action, "Verify the Codex lifecycle hook is configured.");
});

test("hides ready setup diagnostics from dashboard models", () => {
  assert.equal(normalizeSetupDiagnostic({ code: "ready", title: "Ready" }), null);
  assert.equal(buildDashboardModel([], {
    sessionSourceDiagnostic: { code: "ready", title: "Ready" },
  }).setup, null);
});
