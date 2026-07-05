const fs = require("node:fs");

const {
  compactText,
  redactText,
  relativeTimeText,
  shortSessionId,
  statusText,
  truncateText,
} = require("./sessionViewModel");

const TEXT_KEYS = new Set(["text", "message", "content", "last_assistant_message", "summary"]);

function findRole(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return "";
  }
  if (typeof item.role === "string") {
    return item.role;
  }
  if (item.author && typeof item.author === "object" && typeof item.author.role === "string") {
    return item.author.role;
  }
  const itemType = item.type || item.event_name || item.hook_event_name;
  return typeof itemType === "string" ? itemType : "";
}

function collectTexts(item, options = {}) {
  const found = [];
  const maxTexts = options.maxTexts ?? 4;

  function visit(value, key = "") {
    if (found.length >= maxTexts) {
      return;
    }
    if (typeof value === "string") {
      if (TEXT_KEYS.has(key) && value.trim()) {
        found.push(redactText(value.trim(), options));
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) {
        visit(child, key);
      }
      return;
    }
    if (value && typeof value === "object") {
      for (const [childKey, childValue] of Object.entries(value)) {
        visit(childValue, childKey);
      }
    }
  }

  visit(item);
  return found;
}

function skimTranscriptText(text, options = {}) {
  const entries = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const role = findRole(item) || "entry";
    for (const value of collectTexts(item, options)) {
      const compact = compactText(value);
      if (compact) {
        entries.push({ role, text: compact });
      }
    }
  }

  const limit = options.limit ?? 30;
  return limit > 0 ? entries.slice(-limit) : entries;
}

function readTranscriptEntries(session, options = {}) {
  const transcriptPath = String(session?.transcript_path || "");
  if (!transcriptPath) {
    return {
      entries: [],
      message: "No transcript path recorded for this session.",
    };
  }

  try {
    const text = fs.readFileSync(transcriptPath, "utf8");
    const entries = skimTranscriptText(text, options);
    return {
      entries,
      message: entries.length ? "" : "No previewable transcript text found.",
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        entries: [],
        message: "Transcript file is not available on this host.",
      };
    }
    return {
      entries: [],
      message: "Could not read transcript preview.",
    };
  }
}

function sessionTitle(session, options = {}) {
  const title = compactText(
    session?.title || session?.thread_title || session?.conversation_title || session?.summary || "",
  );
  if (title) {
    return truncateText(redactText(title, options), 140);
  }
  const snippet = compactText(redactText(session?.last_assistant_message || "", options));
  if (snippet) {
    return truncateText(`${shortSessionId(session?.session_id)} - ${snippet}`, 140);
  }
  return `${shortSessionId(session?.session_id)} - ${statusText(session?.display_status)} thread`;
}

function buildSessionPreviewModel(session, options = {}) {
  const transcript = readTranscriptEntries(session, options);
  return {
    title: sessionTitle(session, options),
    project: String(session?.project || "-"),
    status: statusText(session?.display_status || session?.status || "unknown"),
    lastSeen: relativeTimeText(session?.last_seen_at, options) || String(session?.last_seen_at || ""),
    lastEvent: String(session?.last_event_name || ""),
    model: String(session?.model || ""),
    currentTool: String(session?.current_tool || ""),
    shortSessionId: shortSessionId(session?.session_id),
    summary: truncateText(compactText(redactText(session?.last_assistant_message || "", options)), 360),
    transcriptMessage: transcript.message,
    transcriptEntries: transcript.entries,
  };
}

module.exports = {
  buildSessionPreviewModel,
  collectTexts,
  findRole,
  readTranscriptEntries,
  skimTranscriptText,
};
