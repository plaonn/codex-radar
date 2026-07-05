const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildDashboardModel,
  findSessionByKey,
  sessionCard,
  statusOptions,
} = require("../src/dashboardViewModel");
const { decorateSessions, markDoneRead, markSessionHidden } = require("../src/readState");

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
    session_id: "hidden-1",
    project: "project-b",
    display_status: "done",
    last_seen_at: "2026-07-05T00:01:00+09:00",
    last_assistant_message: "hidden finished",
  },
];

test("builds a sanitized dashboard model with attention, projects, hidden, and selection", () => {
  const sessions = decorateSessions(
    baseSessions,
    markDoneRead(new Set(), baseSessions[1]),
    markSessionHidden(new Set(), baseSessions[2]),
  );
  const model = buildDashboardModel(sessions, {
    homeDir: "/Users/example",
    nowMs,
  });

  assert.deepEqual(model.counts, {
    total: 3,
    visible: 2,
    filtered: 2,
    attention: 1,
    hidden: 1,
  });
  assert.equal(model.attention[0].sessionId, "approval-1");
  assert.equal(model.groups.length, 1);
  assert.equal(model.groups[0].project, "project-a");
  assert.equal(model.groups[0].sessions.length, 2);
  assert.equal(model.hidden[0].sessionId, "hidden-1");
  assert.equal(model.selected.sessionId, "approval-1");
  assert.equal(model.groups[0].sessions[1].snippet, "[REDACTED] finished");
});

test("filters project sessions by display status without changing attention count", () => {
  const sessions = decorateSessions(baseSessions, new Set(), new Set());
  const model = buildDashboardModel(sessions, {
    statusFilter: "done",
    nowMs,
  });

  assert.equal(model.counts.filtered, 2);
  assert.equal(model.counts.attention, 3);
  assert.deepEqual(model.groups.map((group) => group.project), ["project-a", "project-b"]);
});

test("builds session action state for Webview buttons", () => {
  const unreadDone = decorateSessions([baseSessions[1]], new Set(), new Set())[0];
  const readDone = decorateSessions([baseSessions[1]], markDoneRead(new Set(), baseSessions[1]), new Set())[0];
  const hidden = decorateSessions([baseSessions[2]], new Set(), markSessionHidden(new Set(), baseSessions[2]))[0];

  assert.equal(sessionCard(unreadDone).actions.canMarkRead, true);
  assert.equal(sessionCard(unreadDone).actions.canMarkUnread, false);
  assert.equal(sessionCard(readDone).actions.canMarkRead, false);
  assert.equal(sessionCard(readDone).actions.canMarkUnread, true);
  assert.equal(sessionCard(hidden).actions.canRestore, true);
  assert.equal(sessionCard(hidden).actions.canHide, false);
  assert.equal(sessionCard({ ...unreadDone, session_id: "unknown" }).actions.canOpen, false);
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
