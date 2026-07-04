const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CACHE_SCHEMA_VERSION = 1;
const STALE_SESSION_SECONDS = 30 * 60;
const STALE_ELIGIBLE_STATUSES = new Set(["active", "running", "tool_running"]);
const STATUS_FILTER_VALUES = Object.freeze([
  "all",
  "active",
  "running",
  "tool_running",
  "waiting_approval",
  "done",
  "stale",
  "unknown",
]);

function expandHome(value, homeDir = os.homedir()) {
  if (!value) {
    return value;
  }
  if (value === "~") {
    return homeDir;
  }
  if (value.startsWith("~/")) {
    return path.join(homeDir, value.slice(2));
  }
  return value;
}

function defaultStateDir(env = process.env, homeDir = os.homedir()) {
  if (env.CODEX_RADAR_HOME) {
    return path.resolve(expandHome(env.CODEX_RADAR_HOME, homeDir));
  }
  if (env.XDG_STATE_HOME) {
    return path.join(path.resolve(expandHome(env.XDG_STATE_HOME, homeDir)), "codex-radar");
  }
  return path.join(homeDir, ".local", "state", "codex-radar");
}

function sessionCachePath(stateDir) {
  return path.join(stateDir, "sessions.json");
}

function parseTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function isStaleSession(session, options = {}) {
  const status = String(session.status || "");
  if (!STALE_ELIGIBLE_STATUSES.has(status)) {
    return false;
  }
  const lastSeen = parseTimestamp(session.last_seen_at);
  if (lastSeen === null) {
    return false;
  }
  const nowMs = options.nowMs ?? Date.now();
  const staleMs = (options.staleSeconds ?? STALE_SESSION_SECONDS) * 1000;
  return nowMs - lastSeen > staleMs;
}

function sessionDisplayStatus(session, options = {}) {
  return isStaleSession(session, options) ? "stale" : String(session.status || "");
}

function normalizeSession(sessionId, session, options = {}) {
  const normalized = {
    ...session,
    session_id: String(session.session_id || sessionId),
  };
  normalized.display_status = sessionDisplayStatus(normalized, options);
  return normalized;
}

function sessionsFromPayload(payload, options = {}) {
  if (!payload || payload.schema_version !== CACHE_SCHEMA_VERSION || typeof payload.sessions !== "object") {
    return [];
  }
  return Object.entries(payload.sessions)
    .filter(([, session]) => session && typeof session === "object" && !Array.isArray(session))
    .map(([sessionId, session]) => normalizeSession(sessionId, session, options))
    .sort((a, b) => String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || "")));
}

function loadSessionCache(stateDir, options = {}) {
  const cachePath = sessionCachePath(stateDir);
  let text;
  try {
    text = fs.readFileSync(cachePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  try {
    return sessionsFromPayload(JSON.parse(text), options);
  } catch (error) {
    error.message = `Could not parse ${cachePath}: ${error.message}`;
    throw error;
  }
}

function normalizeStatusFilter(value) {
  const status = String(value || "").trim();
  return status && status !== "all" ? status : "";
}

function filterSessionsByStatus(sessions, statusFilter) {
  const status = normalizeStatusFilter(statusFilter);
  if (!status) {
    return sessions;
  }
  return sessions.filter((session) => String(session.display_status || "") === status);
}

function projectName(session) {
  return String(session.project || "-");
}

function groupSessionsByProject(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const project = projectName(session);
    if (!groups.has(project)) {
      groups.set(project, []);
    }
    groups.get(project).push(session);
  }
  return Array.from(groups, ([project, items]) => ({ project, sessions: items }));
}

module.exports = {
  CACHE_SCHEMA_VERSION,
  STATUS_FILTER_VALUES,
  STALE_SESSION_SECONDS,
  defaultStateDir,
  expandHome,
  filterSessionsByStatus,
  groupSessionsByProject,
  isStaleSession,
  loadSessionCache,
  normalizeStatusFilter,
  sessionCachePath,
  sessionDisplayStatus,
  sessionsFromPayload,
};
