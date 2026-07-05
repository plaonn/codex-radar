const READ_DONE_KEYS_KEY = "codexRadar.readDoneSessionKeys.v1";
const HIDDEN_SESSION_KEYS_KEY = "codexRadar.hiddenSessionKeys.v1";
const ATTENTION_STATUSES = new Set(["waiting_approval", "stale"]);

function sessionStateKey(session) {
  if (!session || typeof session !== "object") {
    return "";
  }
  const sessionId = String(session.session_id || "");
  const lastSeen = String(session.last_seen_at || "");
  if (!sessionId || sessionId === "unknown" || !lastSeen) {
    return "";
  }
  return `${sessionId}\n${lastSeen}`;
}

function readDoneSessionKey(session) {
  return sessionStateKey(session);
}

function hiddenSessionKey(session) {
  return sessionStateKey(session);
}

function readStateFromValue(value) {
  if (!Array.isArray(value)) {
    return new Set();
  }
  return new Set(value.filter((item) => typeof item === "string" && item));
}

function readStateToValue(readKeys) {
  return Array.from(readKeys).sort();
}

function isDoneSession(session) {
  return String(session?.display_status || session?.status || "") === "done";
}

function isDoneRead(session, readKeys) {
  const key = readDoneSessionKey(session);
  return Boolean(key && readKeys.has(key));
}

function isUnreadDone(session, readKeys) {
  return isDoneSession(session) && !isDoneRead(session, readKeys);
}

function markDoneRead(readKeys, session) {
  const next = new Set(readKeys);
  const key = readDoneSessionKey(session);
  if (key) {
    next.add(key);
  }
  return next;
}

function markDoneUnread(readKeys, session) {
  const next = new Set(readKeys);
  const key = readDoneSessionKey(session);
  if (key) {
    next.delete(key);
  }
  return next;
}

function isHiddenSession(session, hiddenKeys) {
  const key = hiddenSessionKey(session);
  return Boolean(key && hiddenKeys.has(key));
}

function markSessionHidden(hiddenKeys, session) {
  const next = new Set(hiddenKeys);
  const key = hiddenSessionKey(session);
  if (key) {
    next.add(key);
  }
  return next;
}

function restoreSession(hiddenKeys, session) {
  const next = new Set(hiddenKeys);
  const key = hiddenSessionKey(session);
  if (key) {
    next.delete(key);
  }
  return next;
}

function isAttentionSession(session, readKeys) {
  const status = String(session?.display_status || "");
  return ATTENTION_STATUSES.has(status) || isUnreadDone(session, readKeys);
}

function decorateSession(session, readKeys, hiddenKeys = new Set()) {
  return {
    ...session,
    is_done_read: isDoneRead(session, readKeys),
    is_unread_done: isUnreadDone(session, readKeys),
    is_attention: isAttentionSession(session, readKeys),
    is_hidden: isHiddenSession(session, hiddenKeys),
  };
}

function decorateSessions(sessions, readKeys, hiddenKeys = new Set()) {
  return sessions.map((session) => decorateSession(session, readKeys, hiddenKeys));
}

module.exports = {
  HIDDEN_SESSION_KEYS_KEY,
  READ_DONE_KEYS_KEY,
  decorateSession,
  decorateSessions,
  hiddenSessionKey,
  isAttentionSession,
  isDoneRead,
  isDoneSession,
  isHiddenSession,
  isUnreadDone,
  markDoneRead,
  markDoneUnread,
  markSessionHidden,
  readDoneSessionKey,
  readStateFromValue,
  readStateToValue,
  restoreSession,
  sessionStateKey,
};
