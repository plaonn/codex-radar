const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const USAGE_SOURCE = "codex-session-rollout";

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

function usageStatusText(snapshot) {
  if (!snapshot || !snapshot.available || !snapshot.primary) {
    return "$(hubot) -- · --";
  }
  const primaryRemaining = Number(snapshot.primary.remaining_percent);
  if (!Number.isFinite(primaryRemaining)) {
    return "$(hubot) -- · --";
  }
  const secondaryRemaining = Number(snapshot.secondary?.remaining_percent);
  const secondaryText = Number.isFinite(secondaryRemaining) ? `${Math.round(secondaryRemaining)}%` : "--";
  const icon = primaryRemaining <= 10 ? "$(error)" : primaryRemaining <= 30 ? "$(warning)" : "$(hubot)";
  return `${icon} ${Math.round(primaryRemaining)}% · ${secondaryText}`;
}

function formatReset(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString();
}

function usageStatusTooltip(snapshot) {
  if (!snapshot || !snapshot.available) {
    return `Codex usage remaining unavailable: ${snapshot?.reason || "unknown"}`;
  }
  const lines = [];
  if (snapshot.primary) {
    lines.push(`5h remaining: ${Math.round(snapshot.primary.remaining_percent)}%`);
    lines.push(`5h used: ${Math.round(snapshot.primary.used_percent)}%`);
    if (snapshot.primary.resets_at_iso) {
      lines.push(`5h reset: ${formatReset(snapshot.primary.resets_at_iso)}`);
    }
  }
  if (snapshot.secondary) {
    lines.push(`7d remaining: ${Math.round(snapshot.secondary.remaining_percent)}%`);
    lines.push(`7d used: ${Math.round(snapshot.secondary.used_percent)}%`);
    if (snapshot.secondary.resets_at_iso) {
      lines.push(`7d reset: ${formatReset(snapshot.secondary.resets_at_iso)}`);
    }
  }
  if (snapshot.plan_type) {
    lines.push(`Plan: ${snapshot.plan_type}`);
  }
  if (snapshot.last_token_usage && Number.isFinite(Number(snapshot.last_token_usage.total_tokens))) {
    lines.push(`Last turn tokens: ${snapshot.last_token_usage.total_tokens}`);
  }
  if (snapshot.context_window) {
    lines.push(`Context window: ${snapshot.context_window}`);
  }
  return lines.join("\n");
}

function usageDetailItems(snapshot) {
  if (!snapshot || !snapshot.available) {
    return [
      {
        label: "Codex usage unavailable",
        description: snapshot?.reason || "unknown",
      },
    ];
  }
  const items = [];
  if (snapshot.primary) {
    items.push({
      label: `5h remaining ${Math.round(snapshot.primary.remaining_percent)}%`,
      description: `${Math.round(snapshot.primary.used_percent)}% used`,
      detail: snapshot.primary.resets_at_iso ? `Reset: ${formatReset(snapshot.primary.resets_at_iso)}` : "",
    });
  }
  if (snapshot.secondary) {
    items.push({
      label: `7d remaining ${Math.round(snapshot.secondary.remaining_percent)}%`,
      description: `${Math.round(snapshot.secondary.used_percent)}% used`,
      detail: snapshot.secondary.resets_at_iso ? `Reset: ${formatReset(snapshot.secondary.resets_at_iso)}` : "",
    });
  }
  if (snapshot.plan_type) {
    items.push({ label: `Plan ${snapshot.plan_type}` });
  }
  if (snapshot.last_token_usage && Number.isFinite(Number(snapshot.last_token_usage.total_tokens))) {
    items.push({ label: `Last turn tokens ${snapshot.last_token_usage.total_tokens}` });
  }
  if (snapshot.context_window) {
    items.push({ label: `Context window ${snapshot.context_window}` });
  }
  return items;
}

module.exports = {
  defaultCodexHome,
  loadUsageSnapshot,
  recentRolloutFiles,
  usageDetailItems,
  usageStatusText,
  usageStatusTooltip,
};
