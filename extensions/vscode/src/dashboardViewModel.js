const {
  STATUS_FILTER_VALUES,
  filterSessionsByStatus,
  groupSessionsByProject,
  normalizeStatusFilter,
} = require("./sessionSource");
const {
  relativeTimeText,
  sessionDescription,
  sessionIconId,
  sessionSnippet,
  sessionTitle,
  statusText,
} = require("./sessionViewModel");
const { isDoneSession, sessionStateKey } = require("./readState");

function statusOptions(currentStatusFilter = "") {
  const current = normalizeStatusFilter(currentStatusFilter) || "all";
  return STATUS_FILTER_VALUES.map((status) => ({
    label: status === "all" ? "All" : status === "attention" ? "Attention" : statusText(status),
    value: normalizeStatusFilter(status),
    isSelected: status === current,
  }));
}

function sessionActionState(session) {
  return {
    canOpen: Boolean(session.session_id && session.session_id !== "unknown" && !String(session.session_id).startsWith("unknown:")),
    canHide: !session.is_hidden,
    canRestore: Boolean(session.is_hidden),
    canMarkRead: isDoneSession(session) && session.is_unread_done,
    canMarkUnread: isDoneSession(session) && session.is_done_read,
  };
}

function sessionCard(session, options = {}) {
  return {
    key: sessionStateKey(session),
    sessionId: String(session.session_id || ""),
    shortSessionId: String(session.session_id || "").slice(0, 12) || "unknown",
    title: sessionTitle(session, options),
    snippet: sessionSnippet(session, { ...options, maxLength: 180 }),
    project: String(session.project || "-"),
    status: String(session.display_status || "unknown"),
    statusText: statusText(session.display_status),
    description: sessionDescription(session, options),
    icon: sessionIconId(session),
    relativeLastSeen: relativeTimeText(session.last_seen_at, options),
    lastSeenAt: String(session.last_seen_at || ""),
    lastEventName: String(session.last_event_name || ""),
    model: String(session.model || ""),
    currentTool: String(session.current_tool || ""),
    isAttention: Boolean(session.is_attention),
    isHidden: Boolean(session.is_hidden),
    isUnreadDone: Boolean(session.is_unread_done),
    isDoneRead: Boolean(session.is_done_read),
    actions: sessionActionState(session),
  };
}

function indexCards(cards) {
  const index = new Map();
  for (const card of cards) {
    if (card.key) {
      index.set(card.key, card);
    }
  }
  return index;
}

function cardsForSessions(sessions, options = {}) {
  return sessions.map((session) => sessionCard(session, options));
}

function projectGroups(sessions, options = {}) {
  return groupSessionsByProject(sessions).map((group) => {
    const cards = cardsForSessions(group.sessions, options);
    return {
      project: group.project,
      total: cards.length,
      attention: cards.filter((card) => card.isAttention).length,
      sessions: cards,
    };
  });
}

function buildDashboardModel(sessions, options = {}) {
  const statusFilter = normalizeStatusFilter(options.statusFilter);
  const activeSessions = sessions.filter((session) => !session.is_hidden);
  const hiddenSessions = sessions.filter((session) => session.is_hidden);
  const filteredSessions = filterSessionsByStatus(activeSessions, statusFilter);
  const attentionSessions = activeSessions.filter((session) => session.is_attention);
  const allCards = cardsForSessions(sessions, options);
  const selectedKey = options.selectedKey && indexCards(allCards).has(options.selectedKey)
    ? options.selectedKey
    : "";

  let selectedSession = null;
  if (selectedKey) {
    const byKey = new Map(sessions.map((session) => [sessionStateKey(session), session]));
    selectedSession = byKey.get(selectedKey) || null;
  }
  if (!selectedSession) {
    selectedSession = attentionSessions[0] || filteredSessions[0] || hiddenSessions[0] || sessions[0] || null;
  }

  return {
    generatedAt: new Date(options.nowMs || Date.now()).toISOString(),
    statusFilter,
    statusOptions: statusOptions(statusFilter),
    counts: {
      total: sessions.length,
      visible: activeSessions.length,
      filtered: filteredSessions.length,
      attention: attentionSessions.length,
      hidden: hiddenSessions.length,
    },
    attention: cardsForSessions(attentionSessions, { ...options, showProject: true }),
    groups: projectGroups(filteredSessions, options),
    hidden: cardsForSessions(hiddenSessions, { ...options, showProject: true }),
    selected: selectedSession ? sessionCard(selectedSession, options) : null,
    emptyState: sessions.length === 0 ? "No sessions indexed" : "",
  };
}

function findSessionByKey(sessions, key) {
  const target = String(key || "");
  if (!target) {
    return null;
  }
  return sessions.find((session) => sessionStateKey(session) === target) || null;
}

module.exports = {
  buildDashboardModel,
  findSessionByKey,
  sessionCard,
  statusOptions,
};
