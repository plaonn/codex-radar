const path = require("node:path");

const OPEN_THREAD_BEHAVIORS = new Set(["ask", "openWorkspace", "openHere"]);
const PENDING_WORKSPACE_HANDOFF_KEY = "codexRadar.pendingWorkspaceHandoff.v1";
const DEFAULT_HANDOFF_MAX_AGE_MS = 5 * 60 * 1000;

function normalizeOpenThreadBehavior(value) {
  const behavior = String(value || "");
  return OPEN_THREAD_BEHAVIORS.has(behavior) ? behavior : "ask";
}

function normalizedFsPath(value) {
  const candidate = String(value || "").trim();
  return candidate ? path.resolve(candidate) : "";
}

function workspaceFolderPath(folder) {
  return normalizedFsPath(folder?.uri?.fsPath || folder?.fsPath || folder?.path || folder);
}

function isSameOrChildPath(targetPath, rootPath) {
  const target = normalizedFsPath(targetPath);
  const root = normalizedFsPath(rootPath);
  if (!target || !root) {
    return false;
  }
  if (target === root) {
    return true;
  }
  const relative = path.relative(root, target);
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function sessionWorkspaceContext(session, workspaceFolders = []) {
  const cwd = normalizedFsPath(session?.cwd);
  if (!cwd) {
    return { kind: "unknown", cwd: "" };
  }
  const isCurrent = workspaceFolders
    .map(workspaceFolderPath)
    .filter(Boolean)
    .some((folder) => isSameOrChildPath(cwd, folder));
  return { kind: isCurrent ? "current" : "other", cwd };
}

async function resolveWorkspaceHandoffAction(session, options = {}) {
  const context = sessionWorkspaceContext(session, options.workspaceFolders);
  if (context.kind !== "other") {
    return { action: "openHere", ...context };
  }

  const behavior = normalizeOpenThreadBehavior(options.behavior);
  if (behavior === "openWorkspace") {
    return { action: "openWorkspace", ...context };
  }
  if (behavior === "openHere") {
    return { action: "openHere", ...context };
  }

  if (typeof options.choose !== "function") {
    return { action: "cancel", ...context };
  }
  const selected = await options.choose(context);
  if (selected === "openWorkspace" || selected === "openHere") {
    return { action: selected, ...context };
  }
  return { action: "cancel", ...context };
}

function createPendingWorkspaceHandoff(session, options = {}) {
  const sessionId = String(session?.session_id || "").trim();
  const cwd = normalizedFsPath(session?.cwd);
  if (!sessionId || !cwd) {
    return null;
  }
  return {
    requestId: String(options.requestId || `${options.now ?? Date.now()}:${sessionId}`),
    sessionId,
    cwd,
    requestedAt: Number.isFinite(options.now) ? options.now : Date.now(),
    displayStatus: String(session?.display_status || session?.status || ""),
    lastSeenAt: String(session?.last_seen_at || ""),
  };
}

function normalizePendingWorkspaceHandoff(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const requestId = String(value.requestId || "").trim();
  const sessionId = String(value.sessionId || "").trim();
  const cwd = normalizedFsPath(value.cwd);
  const requestedAt = Number(value.requestedAt);
  if (!requestId || !sessionId || !cwd || !Number.isFinite(requestedAt)) {
    return null;
  }
  return {
    requestId,
    sessionId,
    cwd,
    requestedAt,
    displayStatus: String(value.displayStatus || ""),
    lastSeenAt: String(value.lastSeenAt || ""),
  };
}

function isPendingWorkspaceHandoffFresh(value, options = {}) {
  const pending = normalizePendingWorkspaceHandoff(value);
  if (!pending) {
    return false;
  }
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const maxAgeMs = Number.isFinite(options.maxAgeMs)
    ? options.maxAgeMs
    : DEFAULT_HANDOFF_MAX_AGE_MS;
  return pending.requestedAt <= now && now - pending.requestedAt <= maxAgeMs;
}

function pendingWorkspaceHandoffMatches(value, workspaceFolders = []) {
  const pending = normalizePendingWorkspaceHandoff(value);
  return Boolean(
    pending
    && workspaceFolders
      .map(workspaceFolderPath)
      .filter(Boolean)
      .some((folder) => isSameOrChildPath(pending.cwd, folder)),
  );
}

module.exports = {
  DEFAULT_HANDOFF_MAX_AGE_MS,
  OPEN_THREAD_BEHAVIORS,
  PENDING_WORKSPACE_HANDOFF_KEY,
  createPendingWorkspaceHandoff,
  isPendingWorkspaceHandoffFresh,
  isSameOrChildPath,
  normalizeOpenThreadBehavior,
  normalizePendingWorkspaceHandoff,
  pendingWorkspaceHandoffMatches,
  resolveWorkspaceHandoffAction,
  sessionWorkspaceContext,
};
