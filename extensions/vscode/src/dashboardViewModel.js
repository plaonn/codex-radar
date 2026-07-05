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
const { resolveTranscriptPathInfo } = require("./transcriptPreview");

function baseDisplayStatus(session) {
  return String(session.display_status || session.status || "unknown");
}

function transcriptPathInfo(session, options = {}) {
  if (typeof options.resolveTranscriptPathInfo === "function") {
    return options.resolveTranscriptPathInfo(session, options);
  }
  return resolveTranscriptPathInfo(session, options);
}

function archiveCacheKey(session) {
  return sessionStateKey(session) || String(session?.session_id || "");
}

function isArchivedSession(session, options = {}) {
  const key = archiveCacheKey(session);
  const cache = options.archivedSessionCache instanceof Map ? options.archivedSessionCache : null;
  if (cache && key && cache.has(key)) {
    return cache.get(key);
  }
  const isArchived = transcriptPathInfo(session, options).source === "archived";
  if (cache && key) {
    cache.set(key, isArchived);
  }
  return isArchived;
}

function statusOptions(currentStatusFilter = "") {
  const current = normalizeStatusFilter(currentStatusFilter) || "all";
  return STATUS_FILTER_VALUES.map((status) => ({
    label: status === "all" ? "All" : status === "attention" ? "Attention" : statusText(status),
    value: normalizeStatusFilter(status),
    isSelected: status === current,
  }));
}

function sessionActionState(session, options = {}) {
  const isArchived = isArchivedSession(session, options);
  return {
    canOpen: !isArchived
      && Boolean(session.session_id && session.session_id !== "unknown" && !String(session.session_id).startsWith("unknown:")),
    canMarkRead: isDoneSession(session) && session.is_unread_done,
    canMarkUnread: isDoneSession(session) && session.is_done_read,
  };
}

function sessionCard(session, options = {}) {
  const status = baseDisplayStatus(session);
  const isArchived = isArchivedSession(session, options);
  const lifecycleSession = { ...session, display_status: status };
  const description = sessionDescription(lifecycleSession, options);
  return {
    key: sessionStateKey(session),
    sessionId: String(session.session_id || ""),
    shortSessionId: String(session.session_id || "").slice(0, 12) || "unknown",
    title: sessionTitle(lifecycleSession, options),
    snippet: sessionSnippet(session, { ...options, maxLength: 180 }),
    project: String(session.project || "-"),
    status,
    statusText: statusText(status),
    description: isArchived ? `${description} | Archived` : description,
    icon: sessionIconId({ ...session, display_status: status }),
    relativeLastSeen: relativeTimeText(session.last_seen_at, options),
    lastSeenAt: String(session.last_seen_at || ""),
    lastEventName: String(session.last_event_name || ""),
    model: String(session.model || ""),
    currentTool: String(session.current_tool || ""),
    isAttention: Boolean(session.is_attention),
    isArchived,
    isUnreadDone: Boolean(session.is_unread_done),
    isDoneRead: Boolean(session.is_done_read),
    actions: sessionActionState(session, options),
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
  const modelOptions = {
    ...options,
    archivedSessionCache: options.archivedSessionCache instanceof Map ? options.archivedSessionCache : new Map(),
  };
  const statusFilter = normalizeStatusFilter(options.statusFilter);
  const archivedSessions = sessions.filter((session) => isArchivedSession(session, modelOptions));
  const activeSessions = sessions.filter((session) => !isArchivedSession(session, modelOptions));
  const filteredSessions = filterSessionsByStatus(activeSessions, statusFilter);
  const attentionSessions = activeSessions.filter((session) => session.is_attention);
  const allCards = cardsForSessions(sessions, modelOptions);
  const selectedKey = options.selectedKey && indexCards(allCards).has(options.selectedKey)
    ? options.selectedKey
    : "";

  let selectedSession = null;
  if (selectedKey) {
    const byKey = new Map(sessions.map((session) => [sessionStateKey(session), session]));
    selectedSession = byKey.get(selectedKey) || null;
  }
  if (!selectedSession) {
    selectedSession = attentionSessions[0] || filteredSessions[0] || archivedSessions[0] || sessions[0] || null;
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
      archived: archivedSessions.length,
    },
    attention: cardsForSessions(attentionSessions, { ...modelOptions, showProject: true }),
    groups: projectGroups(filteredSessions, modelOptions),
    archived: cardsForSessions(archivedSessions, { ...modelOptions, showProject: true }),
    selected: selectedSession ? sessionCard(selectedSession, modelOptions) : null,
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
  baseDisplayStatus,
  buildDashboardModel,
  findSessionByKey,
  isArchivedSession,
  sessionCard,
  statusOptions,
};
