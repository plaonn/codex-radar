const childProcess = require("node:child_process");

const { inspectSessionCache, loadSessionCache } = require("./sessionSource");

const DISPLAY_STATE_CONTRACT = "codex-radar.display-state";
const TRANSCRIPT_PREVIEW_CONTRACT = "codex-radar.transcript-preview";
const EXPORT_CONTRACT_VERSION = 1;
const TRANSCRIPT_PREVIEW_CONTRACT_VERSION = 2;
const DEFAULT_PREVIEW_LIMIT = 120;
const READ_SOURCE_MODES = Object.freeze(["direct", "observe", "export"]);
const DEFAULT_READ_SOURCE_MODE = "export";
const SOURCE_STATUSES = new Set(["ready", "partial", "unavailable", "invalid"]);
const LIFECYCLE_STATUSES = new Set([
  "active",
  "running",
  "tool_running",
  "waiting_approval",
  "done",
  "unknown",
]);
const DISPLAY_STATUSES = new Set([...LIFECYCLE_STATUSES, "stale"]);
const ARCHIVE_STATES = new Set(["active", "archived", "unknown"]);
const DISPLAY_STATE_KEYS = new Set([
  "contract",
  "version",
  "generated_at",
  "source",
  "capabilities",
  "counts",
  "sessions",
  "usage",
]);
const SOURCE_KEYS = new Set(["status", "reason"]);
const COUNT_KEYS = new Set([
  "total",
  "visible",
  "active",
  "archived",
  "archive_unknown",
  "attention",
  "running",
  "done",
]);
const USAGE_KEYS = new Set(["available", "reason", "observed_at", "plan_type", "pools"]);
const USAGE_POOL_KEYS = new Set(["five_hour", "seven_day"]);
const USAGE_WINDOW_KEYS = new Set([
  "window_minutes",
  "used_percent",
  "remaining_percent",
  "resets_at_iso",
]);
const PREVIEW_KEYS = new Set([
  "contract",
  "version",
  "generated_at",
  "session_id",
  "limit",
  "messages",
]);
const SESSION_KEYS = new Set([
  "session_id",
  "project",
  "status",
  "display_status",
  "archive_state",
  "requires_attention",
  "first_seen_at",
  "last_seen_at",
  "display_state_started_at",
  "model",
  "current_tool",
  "event_count",
]);
const TRUSTED_DIRECT_FIELDS = Object.freeze([
  "cwd",
  "transcript_path",
]);
const CODE_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const TIMEZONE_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/;

class ExportSourceError extends Error {
  constructor(code) {
    super(code);
    this.name = "ExportSourceError";
    this.code = code;
  }
}

function normalizeReadSourceMode(value) {
  const mode = String(value || "").trim();
  return READ_SOURCE_MODES.includes(mode) ? mode : DEFAULT_READ_SOURCE_MODE;
}

function commandErrorCode(error) {
  return error && error.code === "ENOENT"
    ? "export_command_unavailable"
    : "export_command_failed";
}

function defaultCommandRunner(args, options = {}) {
  const execFile = options.execFile || childProcess.execFile;
  return new Promise((resolve, reject) => {
    execFile(
      "codex-radar",
      args,
      {
        encoding: "utf8",
        timeout: options.timeoutMs || 5000,
        maxBuffer: options.maxBuffer || 4 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          reject(new ExportSourceError(commandErrorCode(error)));
          return;
        }
        resolve(String(stdout || ""));
      },
    );
  });
}

async function runExportJson(args, options = {}) {
  const runner = options.commandRunner || ((commandArgs) => defaultCommandRunner(commandArgs, options));
  let stdout;
  try {
    stdout = await runner(args);
  } catch (error) {
    if (error instanceof ExportSourceError) {
      throw error;
    }
    throw new ExportSourceError(commandErrorCode(error));
  }
  try {
    return JSON.parse(String(stdout || ""));
  } catch {
    throw new ExportSourceError("export_invalid_json");
  }
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isIsoTimestamp(value) {
  return typeof value === "string"
    && TIMEZONE_PATTERN.test(value)
    && Number.isFinite(Date.parse(value));
}

function isSafeLabel(value) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 128
    && !/[\\/<>\u0000-\u001f\u007f]/.test(value);
}

function validDisplaySession(session) {
  if (!isObject(session) || !hasOnlyKeys(session, SESSION_KEYS)) {
    return false;
  }
  if (typeof session.session_id !== "string" || !SESSION_ID_PATTERN.test(session.session_id)) {
    return false;
  }
  if (!LIFECYCLE_STATUSES.has(session.status)
      || !DISPLAY_STATUSES.has(session.display_status)
      || !ARCHIVE_STATES.has(session.archive_state)) {
    return false;
  }
  if (typeof session.requires_attention !== "boolean"
      || !Number.isInteger(session.event_count)
      || session.event_count < 0) {
    return false;
  }
  for (const field of ["first_seen_at", "last_seen_at", "display_state_started_at"]) {
    if (field in session && !isIsoTimestamp(session[field])) {
      return false;
    }
  }
  for (const field of ["project", "model", "current_tool"]) {
    if (field in session && !isSafeLabel(session[field])) {
      return false;
    }
  }
  return true;
}

function validUsageWindow(value, expectedMinutes) {
  if (value === null) {
    return true;
  }
  if (!isObject(value)
      || !hasOnlyKeys(value, USAGE_WINDOW_KEYS)
      || value.window_minutes !== expectedMinutes) {
    return false;
  }
  for (const field of ["used_percent", "remaining_percent"]) {
    if (field in value
        && (typeof value[field] !== "number" || value[field] < 0 || value[field] > 100)) {
      return false;
    }
  }
  return !("resets_at_iso" in value) || isIsoTimestamp(value.resets_at_iso);
}

function validUsage(usage) {
  return isObject(usage)
    && hasOnlyKeys(usage, USAGE_KEYS)
    && typeof usage.available === "boolean"
    && isObject(usage.pools)
    && hasOnlyKeys(usage.pools, USAGE_POOL_KEYS)
    && Object.prototype.hasOwnProperty.call(usage.pools, "five_hour")
    && Object.prototype.hasOwnProperty.call(usage.pools, "seven_day")
    && validUsageWindow(usage.pools.five_hour, 300)
    && validUsageWindow(usage.pools.seven_day, 10080)
    && (!("observed_at" in usage) || isIsoTimestamp(usage.observed_at))
    && (!("reason" in usage) || (typeof usage.reason === "string" && CODE_PATTERN.test(usage.reason)))
    && (!("plan_type" in usage) || (typeof usage.plan_type === "string" && CODE_PATTERN.test(usage.plan_type)));
}

function validateDisplayState(payload) {
  if (!isObject(payload)
      || !hasOnlyKeys(payload, DISPLAY_STATE_KEYS)
      || payload.contract !== DISPLAY_STATE_CONTRACT
      || payload.version !== EXPORT_CONTRACT_VERSION
      || !isIsoTimestamp(payload.generated_at)
      || !isObject(payload.source)
      || !hasOnlyKeys(payload.source, SOURCE_KEYS)
      || !SOURCE_STATUSES.has(payload.source.status)
      || (("reason" in payload.source)
        && (typeof payload.source.reason !== "string" || !CODE_PATTERN.test(payload.source.reason)))
      || !Array.isArray(payload.capabilities)
      || !payload.capabilities.every((value) => typeof value === "string" && CODE_PATTERN.test(value))
      || new Set(payload.capabilities).size !== payload.capabilities.length
      || !isObject(payload.counts)
      || !hasOnlyKeys(payload.counts, COUNT_KEYS)
      || !Array.from(COUNT_KEYS).every((key) => Number.isInteger(payload.counts[key]) && payload.counts[key] >= 0)
      || !Array.isArray(payload.sessions)
      || !validUsage(payload.usage)
      || !payload.sessions.every(validDisplaySession)) {
    throw new ExportSourceError("display_state_schema_mismatch");
  }
  return payload;
}

function validateTranscriptPreview(payload, expectedSessionId, expectedLimit) {
  const messageKeys = new Set(["role", "text", "timestamp"]);
  if (!isObject(payload)
      || !hasOnlyKeys(payload, PREVIEW_KEYS)
      || payload.contract !== TRANSCRIPT_PREVIEW_CONTRACT
      || payload.version !== TRANSCRIPT_PREVIEW_CONTRACT_VERSION
      || !isIsoTimestamp(payload.generated_at)
      || payload.session_id !== expectedSessionId
      || !SESSION_ID_PATTERN.test(payload.session_id)
      || payload.limit !== expectedLimit
      || expectedLimit < 1
      || expectedLimit > 200
      || !Array.isArray(payload.messages)
      || payload.messages.length > expectedLimit
      || !payload.messages.every((message) => (
        isObject(message)
        && hasOnlyKeys(message, messageKeys)
        && (message.role === "user" || message.role === "assistant")
        && typeof message.text === "string"
        && message.text.length > 0
        && message.text.length <= 20000
        && (!("timestamp" in message) || isIsoTimestamp(message.timestamp))
      ))) {
    throw new ExportSourceError("transcript_preview_schema_mismatch");
  }
  return payload;
}

async function loadExportState(stateDir, options = {}) {
  const payload = await runExportJson(
    ["--state-dir", stateDir, "export", "state", "--json"],
    options,
  );
  return validateDisplayState(payload);
}

async function loadExportPreview(stateDir, sessionId, options = {}) {
  const limit = options.limit || DEFAULT_PREVIEW_LIMIT;
  const payload = await runExportJson(
    [
      "--state-dir",
      stateDir,
      "export",
      "preview",
      String(sessionId || ""),
      "--limit",
      String(limit),
      "--contract-version",
      String(TRANSCRIPT_PREVIEW_CONTRACT_VERSION),
    ],
    options,
  );
  return validateTranscriptPreview(payload, String(sessionId || ""), limit);
}

function trustedDirectMetadata(session) {
  const result = {};
  for (const field of TRUSTED_DIRECT_FIELDS) {
    if (session && Object.prototype.hasOwnProperty.call(session, field)) {
      result[field] = session[field];
    }
  }
  return result;
}

function sessionsFromDisplayState(payload, directSessions = []) {
  const directById = new Map(
    directSessions.map((session) => [String(session.session_id || ""), session]),
  );
  return payload.sessions
    .map((session) => ({
      ...trustedDirectMetadata(directById.get(session.session_id)),
      ...session,
      export_requires_attention: session.requires_attention,
      read_source: "export",
    }))
    .sort((left, right) => (
      String(right.last_seen_at || "").localeCompare(String(left.last_seen_at || ""))
      || left.session_id.localeCompare(right.session_id)
    ));
}

function directParitySession(session, generatedAt) {
  const status = LIFECYCLE_STATUSES.has(String(session.status || ""))
    ? String(session.status)
    : "unknown";
  let displayStatus = status;
  const generatedMs = Date.parse(generatedAt || "");
  const lastSeenMs = Date.parse(session.last_seen_at || "");
  if (["active", "running", "tool_running"].includes(status)
      && Number.isFinite(generatedMs)
      && Number.isFinite(lastSeenMs)
      && generatedMs - lastSeenMs > 30 * 60 * 1000) {
    displayStatus = "stale";
  }
  const result = {
    session_id: String(session.session_id || ""),
    status,
    display_status: displayStatus,
    event_count: Math.max(0, Number.isInteger(session.event_count) ? session.event_count : 0),
  };
  for (const field of [
    "project",
    "first_seen_at",
    "last_seen_at",
    "display_state_started_at",
    "model",
  ]) {
    if (session[field]) {
      result[field] = session[field];
    }
  }
  if (status === "tool_running" && session.current_tool) {
    result.current_tool = session.current_tool;
  }
  return result;
}

function exportParitySession(session) {
  const result = {};
  for (const field of [
    "session_id",
    "status",
    "display_status",
    "event_count",
    "project",
    "first_seen_at",
    "last_seen_at",
    "display_state_started_at",
    "model",
    "current_tool",
  ]) {
    if (Object.prototype.hasOwnProperty.call(session, field)) {
      result[field] = session[field];
    }
  }
  return result;
}

function semanticParity(directSessions, payload) {
  const direct = directSessions
    .map((session) => directParitySession(session, payload.generated_at))
    .sort((left, right) => left.session_id.localeCompare(right.session_id));
  const exported = payload.sessions
    .map(exportParitySession)
    .sort((left, right) => left.session_id.localeCompare(right.session_id));
  return JSON.stringify(direct) === JSON.stringify(exported);
}

function withSourceDiagnostic(diagnostic, fields) {
  return { ...diagnostic, ...fields };
}

function exportDiagnostic(payload, stateDir, sessionsCount) {
  const status = payload.source.status;
  if (status === "ready") {
    return {
      code: "ready",
      severity: "info",
      title: "Codex Radar shared export is available",
      detail: "",
      action: "",
      stateDir,
      cachePath: "",
      sessionsCount,
      lastUpdatedAt: payload.generated_at,
      canLoad: true,
      readSource: "export",
      requestedSource: "export",
      exportSourceStatus: status,
    };
  }
  return {
    code: `export-source-${status}`,
    severity: status === "partial" ? "warning" : "error",
    title: status === "partial"
      ? "Codex Radar shared export is partially available"
      : "Codex Radar shared export is unavailable",
    detail: payload.source.reason ? `Reason: ${payload.source.reason}` : "",
    action: "The direct host-local session adapter remains available as a fallback.",
    stateDir,
    cachePath: "",
    sessionsCount,
    lastUpdatedAt: payload.generated_at,
    canLoad: status === "partial",
    readSource: status === "partial" ? "export" : "direct-fallback",
    requestedSource: "export",
    exportSourceStatus: status,
  };
}

async function loadSessionState(stateDir, options = {}) {
  const mode = normalizeReadSourceMode(options.mode);
  const directDiagnostic = inspectSessionCache(stateDir, options);
  const directSessions = directDiagnostic.canLoad ? loadSessionCache(stateDir, options) : [];
  if (mode === "direct") {
    return {
      sessions: directSessions,
      diagnostic: withSourceDiagnostic(directDiagnostic, {
        readSource: "direct",
        requestedSource: "direct",
        exportObservation: "disabled",
      }),
    };
  }

  let payload;
  try {
    payload = await loadExportState(stateDir, options);
  } catch (error) {
    const fallbackReason = error instanceof ExportSourceError ? error.code : "export_command_failed";
    return {
      sessions: directSessions,
      diagnostic: withSourceDiagnostic(directDiagnostic, {
        readSource: mode === "observe" ? "direct" : "direct-fallback",
        requestedSource: mode,
        exportObservation: "unavailable",
        fallbackReason,
      }),
    };
  }

  if (mode === "observe") {
    return {
      sessions: directSessions,
      diagnostic: withSourceDiagnostic(directDiagnostic, {
        readSource: "direct",
        requestedSource: "observe",
        exportObservation: semanticParity(directSessions, payload) ? "matched" : "mismatch",
        exportSourceStatus: payload.source.status,
      }),
    };
  }

  if (payload.source.status !== "ready" && payload.source.status !== "partial") {
    const diagnostic = exportDiagnostic(payload, stateDir, directSessions.length);
    return {
      sessions: directSessions,
      diagnostic: withSourceDiagnostic(directDiagnostic, {
        ...diagnostic,
        readSource: "direct-fallback",
        fallbackReason: payload.source.reason || `export_source_${payload.source.status}`,
        canLoad: directDiagnostic.canLoad,
      }),
    };
  }
  const sessions = sessionsFromDisplayState(payload, directSessions);
  return {
    sessions,
    diagnostic: exportDiagnostic(payload, stateDir, sessions.length),
  };
}

module.exports = {
  DEFAULT_PREVIEW_LIMIT,
  DEFAULT_READ_SOURCE_MODE,
  DISPLAY_STATE_CONTRACT,
  EXPORT_CONTRACT_VERSION,
  ExportSourceError,
  READ_SOURCE_MODES,
  TRANSCRIPT_PREVIEW_CONTRACT,
  TRANSCRIPT_PREVIEW_CONTRACT_VERSION,
  loadExportPreview,
  loadExportState,
  loadSessionState,
  normalizeReadSourceMode,
  semanticParity,
  sessionsFromDisplayState,
  validateDisplayState,
  validateTranscriptPreview,
};
