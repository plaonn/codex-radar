const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_RECENT_SESSION_MS = 24 * 60 * 60 * 1000;
const STATUS_FILTER_VALUES = Object.freeze([
  "all",
  "attention",
  "active",
  "running",
  "tool_running",
  "waiting_approval",
  "done",
  "unknown",
]);
const CODEX_INTERNAL_PROJECT = "Codex internal";
const CODEX_INTERNAL_SUBDIRECTORIES = Object.freeze(["memories"]);

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

function defaultStateDir(env = process.env, homeDir = os.homedir(), platform = process.platform) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const expandPlatformHome = (value) => {
    if (!value) {
      return value;
    }
    if (value === "~") {
      return homeDir;
    }
    if (value.startsWith("~/")) {
      return pathApi.join(homeDir, value.slice(2));
    }
    return value;
  };
  if (env.CODEX_RADAR_HOME) {
    return pathApi.resolve(expandPlatformHome(env.CODEX_RADAR_HOME));
  }
  if (platform === "win32") {
    return pathApi.join(
      env.LOCALAPPDATA || pathApi.join(homeDir, "AppData", "Local"),
      "codex-radar",
      "state",
    );
  }
  if (env.XDG_STATE_HOME) {
    return pathApi.join(pathApi.resolve(expandPlatformHome(env.XDG_STATE_HOME)), "codex-radar");
  }
  return pathApi.join(homeDir, ".local", "state", "codex-radar");
}

function defaultCodexHome(env = process.env, homeDir = os.homedir(), platform = process.platform) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  if (env.CODEX_HOME) {
    return pathApi.resolve(expandHomeForPlatform(env.CODEX_HOME, homeDir, pathApi));
  }
  return pathApi.join(homeDir, ".codex");
}

function expandHomeForPlatform(value, homeDir, pathApi) {
  if (!value) {
    return value;
  }
  if (value === "~") {
    return homeDir;
  }
  if (value.startsWith("~/")) {
    return pathApi.join(homeDir, value.slice(2));
  }
  return value;
}

function isPathWithin(candidate, parent, pathApi) {
  const relative = pathApi.relative(parent, candidate);
  return relative === ""
    || (!relative.startsWith(`..${pathApi.sep}`) && relative !== ".." && !pathApi.isAbsolute(relative));
}

function classifiedProject(session, options = {}) {
  const platform = options.platform || process.platform;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const env = options.env || process.env;
  const homeDir = options.homeDir || os.homedir();
  const cwd = String(session?.cwd || "").trim();
  if (cwd) {
    const candidate = pathApi.resolve(expandHomeForPlatform(cwd, homeDir, pathApi));
    const codexHome = defaultCodexHome(env, homeDir, platform);
    for (const subdirectory of CODEX_INTERNAL_SUBDIRECTORIES) {
      if (isPathWithin(candidate, pathApi.join(codexHome, subdirectory), pathApi)) {
        return CODEX_INTERNAL_PROJECT;
      }
    }
  }
  return String(session?.project || "");
}

function sessionCachePath(stateDir) {
  return path.join(stateDir, "sessions.json");
}

function sessionSourceDiagnostic(code, fields = {}) {
  return {
    code,
    severity: fields.severity || "info",
    title: fields.title || "",
    detail: fields.detail || "",
    action: fields.action || "",
    stateDir: fields.stateDir || "",
    cachePath: fields.cachePath || "",
    sessionsCount: fields.sessionsCount || 0,
    lastUpdatedAt: fields.lastUpdatedAt || "",
    canLoad: Boolean(fields.canLoad),
  };
}

function sessionDisplayStatus(session) {
  return String(session.status || "");
}

function normalizeSession(sessionId, session, options = {}) {
  const normalized = {
    ...session,
    session_id: String(session.session_id || sessionId),
  };
  const project = classifiedProject(normalized, options);
  if (project || Object.prototype.hasOwnProperty.call(normalized, "project")) {
    normalized.project = project;
  }
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

function latestSessionTimestamp(sessions) {
  return sessions
    .map((session) => Date.parse(session.last_seen_at || ""))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0] || 0;
}

function inspectSessionCache(stateDir, options = {}) {
  const resolvedStateDir = path.resolve(stateDir);
  const cachePath = sessionCachePath(resolvedStateDir);
  const recentAfterMs = Number.isFinite(options.recentAfterMs)
    ? options.recentAfterMs
    : DEFAULT_RECENT_SESSION_MS;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();

  let stateStat;
  try {
    stateStat = fs.statSync(resolvedStateDir);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return sessionSourceDiagnostic("missing-state-dir", {
        severity: "warning",
        title: "Codex Radar state directory not found",
        detail: "No host-local Radar runtime state was found for this VS Code extension host.",
        action: "Install or update the host-local helper, run codex-radar-helper diagnose, then configure the hook and start a Codex turn.",
        stateDir: resolvedStateDir,
        cachePath,
      });
    }
    return sessionSourceDiagnostic("state-dir-unavailable", {
      severity: "error",
      title: "Codex Radar state directory is unavailable",
      detail: "The extension host could not inspect the configured Radar state directory.",
      action: "Check the codexRadar.stateDir setting and filesystem permissions on this host.",
      stateDir: resolvedStateDir,
      cachePath,
    });
  }

  if (!stateStat.isDirectory()) {
    return sessionSourceDiagnostic("state-dir-not-directory", {
      severity: "error",
      title: "Codex Radar state path is not a directory",
      detail: "The configured Radar state path exists but is not a directory.",
      action: "Point codexRadar.stateDir at the directory that contains sessions.json.",
      stateDir: resolvedStateDir,
      cachePath,
    });
  }

  try {
    fs.accessSync(resolvedStateDir, fs.constants.R_OK);
  } catch (error) {
    return sessionSourceDiagnostic("state-dir-unreadable", {
      severity: "error",
      title: "Codex Radar state directory is not readable",
      detail: "The extension host does not have read access to the Radar state directory.",
      action: "Check filesystem permissions for the extension host user.",
      stateDir: resolvedStateDir,
      cachePath,
    });
  }

  let cacheStat;
  try {
    cacheStat = fs.statSync(cachePath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return sessionSourceDiagnostic("missing-session-index", {
        severity: "warning",
        title: "No Codex Radar session index yet",
        detail: "The state directory exists, but sessions.json has not been written.",
        action: "Run codex-radar-helper diagnose to distinguish helper/runtime and hook wiring issues, then start a Codex turn on this host.",
        stateDir: resolvedStateDir,
        cachePath,
      });
    }
    return sessionSourceDiagnostic("session-index-unavailable", {
      severity: "error",
      title: "Codex Radar session index is unavailable",
      detail: "The extension host could not inspect sessions.json.",
      action: "Check sessions.json permissions on this extension host.",
      stateDir: resolvedStateDir,
      cachePath,
    });
  }

  if (!cacheStat.isFile()) {
    return sessionSourceDiagnostic("session-index-not-file", {
      severity: "error",
      title: "Codex Radar session index is not a file",
      detail: "sessions.json exists but is not a regular file.",
      action: "Check codexRadar.stateDir and resolve the conflicting sessions.json path; the extension will not change it.",
      stateDir: resolvedStateDir,
      cachePath,
    });
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  } catch (error) {
    return sessionSourceDiagnostic("session-index-invalid", {
      severity: "error",
      title: "Codex Radar session index cannot be read",
      detail: "sessions.json is unreadable or is not valid JSON.",
      action: "Run codex-radar-helper diagnose, then start a Codex turn with the current helper after resolving any reported issue.",
      stateDir: resolvedStateDir,
      cachePath,
      lastUpdatedAt: cacheStat.mtime.toISOString(),
    });
  }

  if (!payload || payload.schema_version !== CACHE_SCHEMA_VERSION || typeof payload.sessions !== "object") {
    return sessionSourceDiagnostic("session-index-schema-mismatch", {
      severity: "error",
      title: "Codex Radar session index has an unsupported schema",
      detail: `Expected schema_version ${CACHE_SCHEMA_VERSION}.`,
      action: "Update codex-radar or regenerate sessions.json with the current runtime.",
      stateDir: resolvedStateDir,
      cachePath,
      lastUpdatedAt: cacheStat.mtime.toISOString(),
    });
  }

  const sessions = sessionsFromPayload(payload, options);
  if (!sessions.length) {
    return sessionSourceDiagnostic("empty-session-index", {
      severity: "warning",
      title: "No Codex sessions indexed yet",
      detail: "sessions.json is present but does not contain any Radar sessions.",
      action: "Run codex-radar-helper diagnose before treating this as a hook issue, then start a Codex turn and refresh.",
      stateDir: resolvedStateDir,
      cachePath,
      lastUpdatedAt: cacheStat.mtime.toISOString(),
      canLoad: true,
    });
  }

  const latestSeenMs = latestSessionTimestamp(sessions);
  const latestUpdatedAt = latestSeenMs ? new Date(latestSeenMs).toISOString() : cacheStat.mtime.toISOString();
  if (latestSeenMs && nowMs - latestSeenMs > recentAfterMs) {
    return sessionSourceDiagnostic("stale-session-index", {
      severity: "warning",
      title: "No recent Codex Radar updates",
      detail: "The session index exists, but the latest indexed Codex activity is older than the recent-session window.",
      action: "If new Codex activity is expected, run codex-radar-helper diagnose to check the local runtime and hook wiring.",
      stateDir: resolvedStateDir,
      cachePath,
      sessionsCount: sessions.length,
      lastUpdatedAt: latestUpdatedAt,
      canLoad: true,
    });
  }

  return sessionSourceDiagnostic("ready", {
    title: "Codex Radar session index is available",
    stateDir: resolvedStateDir,
    cachePath,
    sessionsCount: sessions.length,
    lastUpdatedAt: latestUpdatedAt,
    canLoad: true,
  });
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
  if (status === "attention") {
    return sessions.filter((session) => session.is_attention);
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
  CODEX_INTERNAL_PROJECT,
  STATUS_FILTER_VALUES,
  classifiedProject,
  defaultStateDir,
  expandHome,
  filterSessionsByStatus,
  groupSessionsByProject,
  inspectSessionCache,
  loadSessionCache,
  normalizeStatusFilter,
  sessionCachePath,
  sessionDisplayStatus,
  sessionsFromPayload,
};
