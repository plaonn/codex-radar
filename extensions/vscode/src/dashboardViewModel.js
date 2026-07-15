const path = require("node:path");

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
  statusText,
} = require("./sessionViewModel");
const { isDoneSession, sessionStateKey } = require("./readState");
const { isArchivedByCodexThreadState } = require("./codexThreadState");
const {
  isArchivedByCodexThreadCatalog,
  sessionWithCatalogTitle,
} = require("./codexThreadCatalog");
const { buildSessionDisplayFields, resolveTranscriptPathInfo } = require("./transcriptPreview");

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

function sessionIdentity(session) {
  return String(session?.session_id || session?.sessionId || "");
}

function isArchivedSession(session, options = {}) {
  if (session?.archive_state === "archived") {
    return true;
  }
  if (session?.archive_state === "active") {
    return false;
  }
  const key = archiveCacheKey(session);
  const cache = options.archivedSessionCache instanceof Map ? options.archivedSessionCache : null;
  if (cache && key && cache.has(key)) {
    return cache.get(key);
  }
  const isArchived = transcriptPathInfo(session, options).source === "archived"
    || isArchivedByCodexThreadCatalog(session, options.codexThreadCatalog)
    || isArchivedByCodexThreadState(session, options);
  if (cache && key) {
    cache.set(key, isArchived);
  }
  return isArchived;
}

function isUnresolvableDoneSession(session, options = {}) {
  if (!isDoneSession(session) || isArchivedSession(session, options)) {
    return false;
  }
  return !transcriptPathInfo(session, options).path;
}

function statusOptions(currentStatusFilter = "") {
  const current = normalizeStatusFilter(currentStatusFilter) || "all";
  return STATUS_FILTER_VALUES.map((status) => ({
    label: status === "all" ? "All" : status === "attention" ? "Needs review" : statusText(status),
    value: normalizeStatusFilter(status),
    isSelected: status === current,
  }));
}

function normalizeSetupDiagnostic(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const code = String(value.code || "");
  if (!code || code === "ready") {
    return null;
  }
  return {
    code,
    severity: String(value.severity || "info"),
    title: String(value.title || "Codex Radar setup needs attention"),
    detail: String(value.detail || ""),
    action: String(value.action || ""),
    sessionsCount: Number.isFinite(value.sessionsCount) ? value.sessionsCount : 0,
    lastUpdatedAt: String(value.lastUpdatedAt || ""),
  };
}

function safeDiagnosticCode(value) {
  const code = String(value || "");
  return /^[a-z0-9][a-z0-9_.-]{0,63}$/.test(code) ? code : "";
}

function normalizeSourceDiagnostic(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const readSource = safeDiagnosticCode(value.readSource);
  if (!readSource) {
    return null;
  }
  return {
    readSource,
    requestedSource: safeDiagnosticCode(value.requestedSource),
    exportObservation: safeDiagnosticCode(value.exportObservation),
    exportSourceStatus: safeDiagnosticCode(value.exportSourceStatus),
    fallbackReason: safeDiagnosticCode(value.fallbackReason),
  };
}

function sessionActionState(session, options = {}) {
  const isArchived = isArchivedSession(session, options);
  const hasResolvableRollout = Boolean(transcriptPathInfo(session, options).path);
  return {
    canOpen: !isArchived
      && hasResolvableRollout
      && Boolean(session.session_id && session.session_id !== "unknown" && !String(session.session_id).startsWith("unknown:")),
    canMarkRead: isDoneSession(session) && session.is_unread_done,
    canMarkUnread: isDoneSession(session) && session.is_done_read,
  };
}

function sessionDisplayFields(session, options = {}) {
  const cache = options.transcriptDisplayFieldCache instanceof Map ? options.transcriptDisplayFieldCache : null;
  const key = archiveCacheKey(session);
  if (cache && key && cache.has(key)) {
    return cache.get(key);
  }
  const fields = buildSessionDisplayFields(session, options);
  if (cache && key) {
    cache.set(key, fields);
  }
  return fields;
}

function sessionCard(session, options = {}) {
  const status = baseDisplayStatus(session);
  const isArchived = isArchivedSession(session, options);
  const lifecycleSession = sessionWithCatalogTitle({ ...session, display_status: status }, options.codexThreadCatalog);
  const description = sessionDescription(lifecycleSession, options);
  const displayFields = sessionDisplayFields(lifecycleSession, { ...options, snippetLength: 180 });
  return {
    key: sessionStateKey(session),
    sessionId: String(session.session_id || ""),
    shortSessionId: String(session.session_id || "").slice(0, 12) || "unknown",
    title: displayFields.title,
    snippet: displayFields.snippet,
    snippetText: displayFields.snippetText,
    snippetSpeaker: displayFields.snippetSpeaker,
    snippetRole: displayFields.snippetRole,
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

function normalizedFsPath(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  return path.resolve(text);
}

function workspaceFolders(options = {}) {
  return (options.workspaceFolders || [])
    .map((folder) => {
      if (typeof folder === "string") {
        return normalizedFsPath(folder);
      }
      return normalizedFsPath(folder?.uri?.fsPath || folder?.fsPath || folder?.path || "");
    })
    .filter(Boolean);
}

function isSameOrChildPath(candidate, parent) {
  const target = normalizedFsPath(candidate);
  const root = normalizedFsPath(parent);
  if (!target || !root) {
    return false;
  }
  if (target === root) {
    return true;
  }
  const relative = path.relative(root, target);
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function sessionWorkspaceIndex(session, folders) {
  for (let index = 0; index < folders.length; index += 1) {
    if (isSameOrChildPath(session.cwd, folders[index])) {
      return index;
    }
  }
  if (!session.cwd) {
    const project = String(session.project || "");
    const fallbackIndex = folders.findIndex((folder) => path.basename(folder) === project);
    if (fallbackIndex >= 0) {
      return fallbackIndex;
    }
  }
  return -1;
}

function sidebarProjectGroups(sessions, options = {}) {
  const folders = workspaceFolders(options);
  const groups = projectGroups(sessions, options).map((group, originalIndex) => {
    const matchingIndexes = group.sessions
      .map((session) => sessionWorkspaceIndex(session, folders))
      .filter((index) => index >= 0);
    const workspaceIndex = matchingIndexes.length ? Math.min(...matchingIndexes) : -1;
    const latestAttentionAt = group.sessions
      .filter((session) => session.isAttention)
      .map((session) => Date.parse(session.lastSeenAt || ""))
      .filter(Number.isFinite)
      .sort((left, right) => right - left)[0] || 0;
    return {
      ...group,
      isCurrentWorkspace: workspaceIndex >= 0,
      workspaceIndex,
      latestAttentionAt,
      originalIndex,
    };
  });

  return groups
    .sort((left, right) => {
      if (left.isCurrentWorkspace && right.isCurrentWorkspace) {
        return left.workspaceIndex - right.workspaceIndex || left.originalIndex - right.originalIndex;
      }
      if (left.isCurrentWorkspace) {
        return -1;
      }
      if (right.isCurrentWorkspace) {
        return 1;
      }
      if (left.attention && right.attention) {
        return right.latestAttentionAt - left.latestAttentionAt
          || left.project.localeCompare(right.project)
          || left.originalIndex - right.originalIndex;
      }
      if (left.attention) {
        return -1;
      }
      if (right.attention) {
        return 1;
      }
      return left.project.localeCompare(right.project) || left.originalIndex - right.originalIndex;
    })
    .map(({ latestAttentionAt, originalIndex, workspaceIndex, ...group }) => group);
}

function buildDashboardModel(sessions, options = {}) {
  const modelOptions = {
    ...options,
    archivedSessionCache: options.archivedSessionCache instanceof Map ? options.archivedSessionCache : new Map(),
    codexThreadStateCache: options.codexThreadStateCache instanceof Map ? options.codexThreadStateCache : new Map(),
    transcriptDisplayFieldCache: options.transcriptDisplayFieldCache instanceof Map ? options.transcriptDisplayFieldCache : new Map(),
  };
  const statusFilter = normalizeStatusFilter(options.statusFilter);
  const setup = normalizeSetupDiagnostic(options.sessionSourceDiagnostic);
  const source = normalizeSourceDiagnostic(options.sessionSourceDiagnostic);
  const archivedSessions = sessions.filter((session) => isArchivedSession(session, modelOptions));
  const activeSessions = sessions.filter((session) => (
    !isArchivedSession(session, modelOptions) && !isUnresolvableDoneSession(session, modelOptions)
  ));
  const filteredSessions = filterSessionsByStatus(activeSessions, statusFilter);
  const attentionSessions = activeSessions.filter((session) => session.is_attention);
  const runningSessions = activeSessions.filter((session) => {
    const status = baseDisplayStatus(session);
    return status === "running" || status === "tool_running";
  });
  const selectableSessions = activeSessions.concat(archivedSessions);
  const allCards = cardsForSessions(selectableSessions, modelOptions);
  const selectedKey = options.selectedKey && indexCards(allCards).has(options.selectedKey)
    ? options.selectedKey
    : "";
  const selectedIdentity = String(options.selectedIdentity || "");

  let selectedSession = null;
  if (selectedKey) {
    const byKey = new Map(sessions.map((session) => [sessionStateKey(session), session]));
    selectedSession = byKey.get(selectedKey) || null;
  }
  if (!selectedSession && selectedIdentity) {
    selectedSession = selectableSessions.find((session) => sessionIdentity(session) === selectedIdentity) || null;
  }
  if (!selectedSession) {
    selectedSession = attentionSessions[0] || filteredSessions[0] || archivedSessions[0] || selectableSessions[0] || null;
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
      running: runningSessions.length,
      archived: archivedSessions.length,
    },
    attention: cardsForSessions(attentionSessions, { ...modelOptions, showProject: true }),
    groups: projectGroups(filteredSessions, modelOptions),
    sidebarGroups: sidebarProjectGroups(filteredSessions, modelOptions),
    archived: cardsForSessions(archivedSessions, { ...modelOptions, showProject: true }),
    selected: selectedSession ? sessionCard(selectedSession, modelOptions) : null,
    emptyState: sessions.length === 0 ? (setup?.title || "No sessions indexed") : "",
    setup,
    source,
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
  isUnresolvableDoneSession,
  normalizeSourceDiagnostic,
  normalizeSetupDiagnostic,
  sidebarProjectGroups,
  sessionCard,
  sessionDisplayFields,
  sessionIdentity,
  statusOptions,
};
