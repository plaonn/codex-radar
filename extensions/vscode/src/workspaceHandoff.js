const path = require("node:path");

const OPEN_THREAD_BEHAVIORS = new Set(["ask", "openWorkspace", "openHere"]);

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

module.exports = {
  OPEN_THREAD_BEHAVIORS,
  isSameOrChildPath,
  normalizeOpenThreadBehavior,
  resolveWorkspaceHandoffAction,
  sessionWorkspaceContext,
};
