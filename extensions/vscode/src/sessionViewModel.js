const ATTENTION_STATUSES = new Set(["waiting_approval", "running", "tool_running", "stale"]);
const STATUS_TEXT = new Map([
  ["active", "Active"],
  ["done", "Done"],
  ["running", "Running"],
  ["stale", "Stale"],
  ["tool_running", "Tool running"],
  ["unknown", "Unknown"],
  ["waiting_approval", "Waiting approval"],
]);

function shortSessionId(sessionId) {
  const value = String(sessionId || "");
  if (!value || value === "unknown") {
    return "unknown";
  }
  return value.length > 12 ? value.slice(0, 12) : value;
}

function statusText(status) {
  const value = String(status || "unknown");
  return STATUS_TEXT.get(value) || value;
}

function sessionLabel(session) {
  return `${statusText(session.display_status)} - ${shortSessionId(session.session_id)}`;
}

function relativeTimeText(timestamp, options = {}) {
  const valueMs = Date.parse(String(timestamp || ""));
  if (!Number.isFinite(valueMs)) {
    return "";
  }

  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const diffSeconds = Math.max(0, Math.floor((nowMs - valueMs) / 1000));
  if (diffSeconds < 60) {
    return "now";
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return new Date(valueMs).toISOString().slice(0, 10);
}

function sessionDescription(session, options = {}) {
  const parts = [];
  if (session.current_tool) {
    parts.push(String(session.current_tool));
  }
  if (session.last_event_name) {
    parts.push(String(session.last_event_name));
  }
  if (session.model) {
    parts.push(String(session.model));
  }
  const lastSeen = relativeTimeText(session.last_seen_at, options);
  if (lastSeen) {
    parts.push(lastSeen);
  }
  return parts.join(" | ");
}

function sessionTooltip(session, options = {}) {
  return [
    `Project: ${session.project || "-"}`,
    `Status: ${statusText(session.display_status)}`,
    `Last event: ${session.last_event_name || "-"}`,
    `Last seen: ${relativeTimeText(session.last_seen_at, options) || session.last_seen_at || "-"}`,
    `Model: ${session.model || "-"}`,
    `Current tool: ${session.current_tool || "-"}`,
  ].join("\n");
}

function attentionCount(sessions) {
  return sessions.filter((session) => ATTENTION_STATUSES.has(session.display_status)).length;
}

function attentionBadge(sessions) {
  const attention = attentionCount(sessions);
  if (attention === 0) {
    return undefined;
  }
  return {
    value: attention,
    tooltip: `${attention} attention session${attention === 1 ? "" : "s"}`,
  };
}

function projectLabel(project, sessions) {
  const attention = attentionCount(sessions);
  const total = sessions.length;
  if (attention > 0) {
    return `${project} - ${attention} attention / ${total}`;
  }
  return `${project} (${total})`;
}

module.exports = {
  attentionBadge,
  attentionCount,
  projectLabel,
  relativeTimeText,
  sessionDescription,
  sessionLabel,
  sessionTooltip,
  shortSessionId,
  statusText,
};
