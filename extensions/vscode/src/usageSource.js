const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const USAGE_SOURCE = "codex-session-rollout";
const APP_SERVER_USAGE_SOURCE = "codex-app-server";

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

function defaultCodexHome(env = process.env, homeDir = os.homedir()) {
  if (env.CODEX_HOME) {
    return path.resolve(expandHome(env.CODEX_HOME, homeDir));
  }
  return path.join(homeDir, ".codex");
}

function collectRolloutFiles(directory, files = []) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return files;
    }
    throw error;
  }
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectRolloutFiles(child, files);
    } else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) {
      const stat = fs.statSync(child);
      files.push({ path: child, mtimeMs: stat.mtimeMs });
    }
  }
  return files;
}

function recentRolloutFiles(codexHome = defaultCodexHome(), limit = 30) {
  return collectRolloutFiles(path.join(codexHome, "sessions"))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, Math.max(0, limit));
}

function tokenCountPayload(line) {
  let item;
  try {
    item = JSON.parse(line);
  } catch {
    return null;
  }
  const payload = item && typeof item === "object" ? item.payload : null;
  if (!payload || typeof payload !== "object" || payload.type !== "token_count") {
    return null;
  }
  return payload;
}

function latestTokenCountInFile(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  let latest = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("token_count")) {
      continue;
    }
    const payload = tokenCountPayload(line);
    if (payload) {
      latest = payload;
    }
  }
  return latest;
}

function isoFromEpochSeconds(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }
  return new Date(timestamp * 1000).toISOString();
}

function rateWindow(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const usedPercent = Number(value.used_percent);
  const window = {};
  if (Number.isFinite(usedPercent)) {
    window.used_percent = usedPercent;
    window.remaining_percent = Math.max(0, 100 - usedPercent);
  }
  if (Number.isFinite(Number(value.window_minutes))) {
    window.window_minutes = Number(value.window_minutes);
  }
  if (Number.isFinite(Number(value.resets_at))) {
    window.resets_at = Number(value.resets_at);
    window.resets_at_iso = isoFromEpochSeconds(value.resets_at);
  }
  return window;
}

function appServerRateWindow(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const usedPercent = Number(value.usedPercent);
  if (!Number.isFinite(usedPercent)) {
    return null;
  }
  const window = {};
  window.used_percent = usedPercent;
  window.remaining_percent = Math.max(0, 100 - usedPercent);
  if (value.windowDurationMins != null && Number.isFinite(Number(value.windowDurationMins))) {
    window.window_minutes = Number(value.windowDurationMins);
  }
  if (value.resetsAt != null && Number.isFinite(Number(value.resetsAt))) {
    window.resets_at = Number(value.resetsAt);
    window.resets_at_iso = isoFromEpochSeconds(value.resetsAt);
  }
  return window;
}

function appServerUsageSnapshot(response, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const rateLimits = response?.rateLimits;
  const base = {
    available: false,
    source: APP_SERVER_USAGE_SOURCE,
    generated_at: generatedAt,
    observed_at: generatedAt,
  };
  if (!rateLimits || typeof rateLimits !== "object") {
    return { ...base, reason: "app_server_rate_limits_unavailable" };
  }
  const primary = appServerRateWindow(rateLimits.primary);
  const secondary = appServerRateWindow(rateLimits.secondary);
  if (!primary && !secondary) {
    return { ...base, reason: "app_server_rate_limits_unavailable" };
  }
  return {
    ...base,
    available: true,
    limit_id: rateLimits.limitId,
    limit_name: rateLimits.limitName,
    plan_type: rateLimits.planType,
    primary,
    secondary,
    credits: rateLimits.credits,
    individual_limit: rateLimits.individualLimit,
    rate_limit_reached_type: rateLimits.rateLimitReachedType,
  };
}

function loadUsageSnapshot(options = {}) {
  const codexHome = options.codexHome || defaultCodexHome(options.env, options.homeDir);
  const files = recentRolloutFiles(codexHome, options.fileLimit || 30);
  const base = {
    available: false,
    source: USAGE_SOURCE,
    generated_at: new Date().toISOString(),
    checked_files: 0,
  };
  for (const file of files) {
    base.checked_files += 1;
    const payload = latestTokenCountInFile(file.path);
    if (!payload) {
      continue;
    }
    const info = payload.info && typeof payload.info === "object" ? payload.info : {};
    const rateLimits = payload.rate_limits && typeof payload.rate_limits === "object" ? payload.rate_limits : null;
    const tokenUsage = {
      context_window: info.model_context_window,
      last_token_usage: info.last_token_usage && typeof info.last_token_usage === "object" ? info.last_token_usage : null,
      total_token_usage: info.total_token_usage && typeof info.total_token_usage === "object" ? info.total_token_usage : null,
    };
    if (!rateLimits) {
      return {
        ...base,
        observed_at: new Date(file.mtimeMs).toISOString(),
        reason: "rate_limits_unavailable",
        ...tokenUsage,
      };
    }
    return {
      ...base,
      available: true,
      observed_at: new Date(file.mtimeMs).toISOString(),
      limit_id: rateLimits.limit_id,
      limit_name: rateLimits.limit_name,
      plan_type: rateLimits.plan_type,
      primary: rateWindow(rateLimits.primary),
      secondary: rateWindow(rateLimits.secondary),
      credits: rateLimits.credits,
      individual_limit: rateLimits.individual_limit,
      rate_limit_reached_type: rateLimits.rate_limit_reached_type,
      ...tokenUsage,
    };
  }
  return { ...base, reason: "token_count_unavailable" };
}

function semanticRateWindows(snapshot) {
  const windows = {
    fiveHour: null,
    sevenDay: null,
  };
  const candidates = [snapshot?.primary, snapshot?.secondary]
    .filter((window) => window && typeof window === "object");
  for (const window of candidates) {
    const windowMinutes = Number(window.window_minutes);
    if (windowMinutes === 300) {
      windows.fiveHour = window;
    } else if (windowMinutes === 10080) {
      windows.sevenDay = window;
    }
  }

  // Preserve compatibility with older rollout events that omitted window_minutes.
  if (!windows.fiveHour && snapshot?.primary && !Number.isFinite(Number(snapshot.primary.window_minutes))) {
    windows.fiveHour = snapshot.primary;
  }
  if (!windows.sevenDay && snapshot?.secondary && !Number.isFinite(Number(snapshot.secondary.window_minutes))) {
    windows.sevenDay = snapshot.secondary;
  }
  return windows;
}

function comparableSemanticWindows(snapshot) {
  const { fiveHour, sevenDay } = semanticRateWindows(snapshot);
  const comparable = (window) => window ? {
    remaining_percent: Number.isFinite(Number(window.remaining_percent))
      ? Math.round(Number(window.remaining_percent))
      : null,
    resets_at: Number.isFinite(Number(window.resets_at)) ? Number(window.resets_at) : null,
    window_minutes: Number.isFinite(Number(window.window_minutes)) ? Number(window.window_minutes) : null,
  } : null;
  return {
    fiveHour: comparable(fiveHour),
    sevenDay: comparable(sevenDay),
  };
}

function usageSnapshotParity(appServerSnapshot, rolloutSnapshot) {
  if (!rolloutSnapshot?.available) {
    return "unavailable";
  }
  return JSON.stringify(comparableSemanticWindows(appServerSnapshot))
    === JSON.stringify(comparableSemanticWindows(rolloutSnapshot))
    ? "matched"
    : "mismatched";
}

function unavailableRolloutSnapshot() {
  return {
    available: false,
    source: USAGE_SOURCE,
    reason: "rollout_usage_unavailable",
  };
}

async function loadUsageSnapshotWithAppServer(appServerController, options = {}) {
  const fallbackLoader = options.fallbackLoader || (() => loadUsageSnapshot(options));
  let fallbackSnapshot;
  const loadFallback = () => {
    if (fallbackSnapshot) {
      return fallbackSnapshot;
    }
    try {
      fallbackSnapshot = fallbackLoader();
    } catch {
      fallbackSnapshot = unavailableRolloutSnapshot();
    }
    return fallbackSnapshot;
  };

  try {
    const response = await appServerController.readRateLimits(options.appServerOptions || {});
    const appServerSnapshot = appServerUsageSnapshot(response, options);
    if (appServerSnapshot.available) {
      const rolloutSnapshot = loadFallback();
      return {
        ...appServerSnapshot,
        fallback_source: rolloutSnapshot.source,
        fallback_observation: usageSnapshotParity(appServerSnapshot, rolloutSnapshot),
      };
    }
  } catch {
    // The rollout adapter remains the one-release fallback for app-server failures.
  }

  return {
    ...loadFallback(),
    fallback_reason: "app_server_unavailable",
  };
}

function usageStatusText(snapshot) {
  if (!snapshot || !snapshot.available) {
    return "$(hubot) -- · --";
  }
  const { fiveHour, sevenDay } = semanticRateWindows(snapshot);
  const fiveHourRemaining = Number(fiveHour?.remaining_percent);
  const sevenDayRemaining = Number(sevenDay?.remaining_percent);
  const remainingValues = [fiveHourRemaining, sevenDayRemaining].filter(Number.isFinite);
  if (!remainingValues.length) {
    return "$(hubot) -- · --";
  }
  const lowestRemaining = Math.min(...remainingValues);
  const fiveHourText = Number.isFinite(fiveHourRemaining) ? `${Math.round(fiveHourRemaining)}%` : "--";
  const sevenDayText = Number.isFinite(sevenDayRemaining) ? `${Math.round(sevenDayRemaining)}%` : "--";
  const icon = lowestRemaining <= 10 ? "$(error)" : lowestRemaining <= 30 ? "$(warning)" : "$(hubot)";
  return `${icon} ${fiveHourText} · ${sevenDayText}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatReset(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return [
    date.getFullYear(),
    "-",
    pad2(date.getMonth() + 1),
    "-",
    pad2(date.getDate()),
    " ",
    pad2(date.getHours()),
    ":",
    pad2(date.getMinutes()),
    ":",
    pad2(date.getSeconds()),
  ].join("");
}

function formatDurationUntil(value, nowMs = Date.now()) {
  if (!value) {
    return "";
  }
  const resetMs = new Date(value).getTime();
  if (!Number.isFinite(resetMs)) {
    return "";
  }
  const totalMinutes = Math.max(0, Math.ceil((resetMs - nowMs) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) {
    parts.push(`${days}d`);
  }
  if (hours || days) {
    parts.push(`${hours}h`);
  }
  parts.push(`${minutes}m`);
  return `${parts.join(" ")} left`;
}

function resetLine(label, window, nowMs) {
  if (!window) {
    return [];
  }
  const lines = [`${label}: ${Math.round(window.remaining_percent)}% remaining`];
  if (window.resets_at_iso) {
    const left = formatDurationUntil(window.resets_at_iso, nowMs);
    const reset = formatReset(window.resets_at_iso);
    lines.push(` - reset: ${left} (${reset})`);
  }
  return lines;
}

function usageStatusTooltip(snapshot, options = {}) {
  if (!snapshot || !snapshot.available) {
    return `Codex usage remaining unavailable: ${snapshot?.reason || "unknown"}`;
  }
  const nowMs = options.nowMs ?? Date.now();
  const { fiveHour, sevenDay } = semanticRateWindows(snapshot);
  let lines = [];
  if (fiveHour) {
    lines = lines.concat(resetLine("5h", fiveHour, nowMs));
  }
  if (sevenDay) {
    lines = lines.concat(resetLine("7d", sevenDay, nowMs));
  }
  if (snapshot.plan_type) {
    lines.push(`Plan: ${snapshot.plan_type}`);
  }
  if (snapshot.source === APP_SERVER_USAGE_SOURCE) {
    lines.push("Source: Codex app-server");
  } else if (snapshot.fallback_reason) {
    lines.push("Source: rollout fallback");
  }
  if (snapshot.fallback_observation) {
    lines.push(`Rollout fallback parity: ${snapshot.fallback_observation}`);
  }
  return lines.join("\n");
}

module.exports = {
  APP_SERVER_USAGE_SOURCE,
  appServerUsageSnapshot,
  defaultCodexHome,
  formatDurationUntil,
  formatReset,
  loadUsageSnapshot,
  loadUsageSnapshotWithAppServer,
  recentRolloutFiles,
  semanticRateWindows,
  usageStatusText,
  usageStatusTooltip,
  usageSnapshotParity,
};
