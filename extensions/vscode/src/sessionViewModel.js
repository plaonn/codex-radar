const ATTENTION_STATUSES = new Set(["waiting_approval", "running", "tool_running", "stale"]);

function shortSessionId(sessionId) {
  const value = String(sessionId || "");
  if (!value || value === "unknown") {
    return "unknown";
  }
  return value.length > 12 ? value.slice(0, 12) : value;
}

function statusText(status) {
  return String(status || "unknown");
}

function sessionLabel(session) {
  return `${statusText(session.display_status)} ${shortSessionId(session.session_id)}`;
}

function sessionDescription(session) {
  const parts = [];
  if (session.last_event_name) {
    parts.push(String(session.last_event_name));
  }
  if (session.model) {
    parts.push(String(session.model));
  }
  if (session.last_seen_at) {
    parts.push(String(session.last_seen_at));
  }
  return parts.join(" | ");
}

function attentionCount(sessions) {
  return sessions.filter((session) => ATTENTION_STATUSES.has(session.display_status)).length;
}

function projectLabel(project, sessions) {
  const attention = attentionCount(sessions);
  const total = sessions.length;
  if (attention > 0) {
    return `${project} (${attention} attention / ${total} total)`;
  }
  return `${project} (${total})`;
}

module.exports = {
  attentionCount,
  projectLabel,
  sessionDescription,
  sessionLabel,
  shortSessionId,
  statusText,
};
