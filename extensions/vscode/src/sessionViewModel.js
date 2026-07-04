const STATUS_TEXT = new Map([
  ["active", "Active"],
  ["done", "Done"],
  ["running", "Running"],
  ["stale", "Stale"],
  ["tool_running", "Tool running"],
  ["unknown", "Unknown"],
  ["waiting_approval", "Waiting approval"],
]);
const SECRET_PATTERNS = Object.freeze([
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[^'"\s,}]+/gi,
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

function redactText(text, options = {}) {
  let redacted = String(text || "");
  const homeDir = options.homeDir || "";
  if (homeDir && redacted.includes(homeDir)) {
    redacted = redacted.split(homeDir).join("~");
  }
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

function compactText(text) {
  return String(text || "").split(/\s+/).filter(Boolean).join(" ");
}

function truncateText(text, maxLength = 96) {
  const value = String(text || "");
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function sessionSnippet(session, options = {}) {
  const message = redactText(session.last_assistant_message || "", options);
  return truncateText(compactText(message), options.maxLength ?? 96);
}

function sessionTitle(session, options = {}) {
  const shortId = shortSessionId(session.session_id);
  const title = compactText(
    session.title || session.thread_title || session.conversation_title || session.summary || "",
  );
  if (title) {
    return truncateText(redactText(title, options), options.maxLength ?? 96);
  }

  const snippet = sessionSnippet(session, options);
  if (snippet) {
    return truncateText(`${shortId} - ${snippet}`, options.maxLength ?? 96);
  }

  return `${shortId} - ${statusText(session.display_status)} thread`;
}

function sessionLabel(session) {
  return sessionTitle(session);
}

function sessionIconId(session) {
  const status = String(session.display_status || "");
  if (status === "waiting_approval") {
    return "warning";
  }
  if (status === "running" || status === "tool_running") {
    return "sync~spin";
  }
  if (status === "stale") {
    return "watch";
  }
  if (status === "done") {
    return session.is_unread_done ? "mail" : "mail-read";
  }
  return "circle-outline";
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
  const status = statusText(session.display_status);
  if (session.is_unread_done) {
    parts.push("Unread done");
  } else if (String(session.display_status || "") === "done") {
    parts.push("Read done");
  } else if (status) {
    parts.push(status);
  }
  if (session.current_tool) {
    parts.push(String(session.current_tool));
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
    `Read: ${session.is_unread_done ? "Unread" : session.is_done_read ? "Read" : "-"}`,
    `Last event: ${session.last_event_name || "-"}`,
    `Last seen: ${relativeTimeText(session.last_seen_at, options) || session.last_seen_at || "-"}`,
    `Model: ${session.model || "-"}`,
    `Current tool: ${session.current_tool || "-"}`,
    `Session: ${shortSessionId(session.session_id)}`,
  ].join("\n");
}

function attentionCount(sessions) {
  return sessions.filter((session) => session.is_attention).length;
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
  compactText,
  projectLabel,
  relativeTimeText,
  redactText,
  sessionDescription,
  sessionIconId,
  sessionLabel,
  sessionSnippet,
  sessionTitle,
  sessionTooltip,
  shortSessionId,
  statusText,
  truncateText,
};
