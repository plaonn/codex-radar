const assert = require("node:assert/strict");
const test = require("node:test");

const {
  baseDisplayStatus,
  buildDashboardModel,
  findSessionByKey,
  isArchivedSession,
  sessionCard,
  statusOptions,
} = require("../src/dashboardViewModel");
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
  return {
    path: session.session_id === "archived-1" ? "/tmp/archived.jsonl" : "",
    source: session.session_id === "archived-1" ? "archived" : "missing",
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

test("builds session action state for Webview buttons", () => {
  const unreadDone = decorateSessions([baseSessions[1]], new Set(), new Set())[0];
  const readDone = decorateSessions([baseSessions[1]], markDoneRead(new Set(), baseSessions[1]), new Set())[0];
  const archived = decorateSessions([baseSessions[2]], new Set(), new Set())[0];

  assert.equal(sessionCard(unreadDone).actions.canMarkRead, true);
  assert.equal(sessionCard(unreadDone).actions.canMarkUnread, false);
  assert.equal(sessionCard(readDone).actions.canMarkRead, false);
  assert.equal(sessionCard(readDone).actions.canMarkUnread, true);
  assert.equal(sessionCard(archived, { resolveTranscriptPathInfo: archiveResolver }).actions.canOpen, false);
  assert.equal(sessionCard(archived, { resolveTranscriptPathInfo: archiveResolver }).isArchived, true);
  assert.equal(sessionCard({ ...unreadDone, session_id: "unknown" }).actions.canOpen, false);
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

test("finds sessions by timestamp state key", () => {
  const target = findSessionByKey(baseSessions, "done-1\n2026-07-05T00:00:00+09:00");

  assert.equal(target.session_id, "done-1");
  assert.equal(findSessionByKey(baseSessions, ""), null);
});

test("labels dashboard status options", () => {
  assert.deepEqual(statusOptions("attention").slice(0, 3), [
    { label: "All", value: "", isSelected: false },
    { label: "Attention", value: "attention", isSelected: true },
    { label: "Active", value: "active", isSelected: false },
  ]);
});
