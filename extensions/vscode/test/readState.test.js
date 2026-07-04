const assert = require("node:assert/strict");
const test = require("node:test");

const {
  decorateSessions,
  isAttentionSession,
  isUnreadDone,
  markDoneRead,
  markDoneUnread,
  readDoneSessionKey,
  readStateFromValue,
  readStateToValue,
} = require("../src/readState");

const doneSession = {
  session_id: "session-1",
  display_status: "done",
  last_seen_at: "2026-07-05T00:00:00+09:00",
};

test("keys read state by session id and done timestamp", () => {
  assert.equal(readDoneSessionKey(doneSession), "session-1\n2026-07-05T00:00:00+09:00");
  assert.equal(readDoneSessionKey({ ...doneSession, last_seen_at: "" }), "");
  assert.equal(readDoneSessionKey({ ...doneSession, session_id: "unknown" }), "");
});

test("marks done sessions read and unread", () => {
  const readKeys = markDoneRead(new Set(), doneSession);

  assert.equal(isUnreadDone(doneSession, readKeys), false);
  assert.deepEqual(readStateToValue(readKeys), ["session-1\n2026-07-05T00:00:00+09:00"]);
  assert.equal(isUnreadDone(doneSession, markDoneUnread(readKeys, doneSession)), true);
});

test("loads persisted read state defensively", () => {
  assert.deepEqual(readStateToValue(readStateFromValue(["b", "", 1, "a"])), ["a", "b"]);
  assert.deepEqual(readStateToValue(readStateFromValue({})), []);
});

test("counts only unread done, waiting approval, and stale as attention", () => {
  const readKeys = markDoneRead(new Set(), doneSession);

  assert.equal(isAttentionSession(doneSession, new Set()), true);
  assert.equal(isAttentionSession(doneSession, readKeys), false);
  assert.equal(isAttentionSession({ display_status: "running" }, readKeys), false);
  assert.equal(isAttentionSession({ display_status: "tool_running" }, readKeys), false);
  assert.equal(isAttentionSession({ display_status: "waiting_approval" }, readKeys), true);
  assert.equal(isAttentionSession({ display_status: "stale" }, readKeys), true);
});

test("decorates sessions with read and attention state", () => {
  const [readDone, unreadDone] = decorateSessions(
    [
      doneSession,
      { ...doneSession, last_seen_at: "2026-07-05T00:01:00+09:00" },
    ],
    markDoneRead(new Set(), doneSession),
  );

  assert.equal(readDone.is_done_read, true);
  assert.equal(readDone.is_attention, false);
  assert.equal(unreadDone.is_unread_done, true);
  assert.equal(unreadDone.is_attention, true);
});
