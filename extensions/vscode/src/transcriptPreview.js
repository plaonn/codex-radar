const fs = require("node:fs");
const os = require("node:os");

const SECRET_PATTERNS = Object.freeze([
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[^'"\s,}]+/gi,
]);

const TEXT_KEYS = new Set(["text", "message", "content", "last_assistant_message", "summary"]);

function redact(text, homeDir = os.homedir()) {
  let redacted = String(text);
  if (homeDir && redacted.includes(homeDir)) {
    redacted = redacted.split(homeDir).join("~");
  }
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

function parseJsonl(text) {
  const items = [];
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const item = JSON.parse(trimmed);
      if (item && typeof item === "object" && !Array.isArray(item)) {
        items.push(item);
      }
    } catch (_error) {
      // Match the Python skim behavior: invalid JSONL rows are ignored.
    }
  }
  return items;
}

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
  const maxTexts = options.maxTexts ?? 4;
  const homeDir = options.homeDir ?? os.homedir();
  const found = [];

  function visit(value, key = "") {
    if (found.length >= maxTexts) {
      return;
    }
    if (typeof value === "string") {
      if (TEXT_KEYS.has(key) && value.trim()) {
        found.push(redact(value.trim(), homeDir));
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

function skimTranscript(transcriptPath, options = {}) {
  if (!fs.existsSync(transcriptPath)) {
    const error = new Error("Transcript file not found.");
    error.code = "ENOENT";
    throw error;
  }

  const limit = options.limit ?? 30;
  const homeDir = options.homeDir ?? os.homedir();
  const entries = [];
  for (const item of parseJsonl(fs.readFileSync(transcriptPath, "utf8"))) {
    const role = findRole(item) || "entry";
    for (const text of collectTexts(item, { homeDir })) {
      const compact = text.split(/\s+/).join(" ");
      if (compact) {
        entries.push([role, compact]);
      }
    }
  }

  return limit > 0 ? entries.slice(-limit) : entries;
}

function formatSkim(entries, options = {}) {
  const width = options.width ?? 100;
  return Array.from(entries, ([roleValue, textValue]) => {
    const role = String(roleValue);
    let text = String(textValue);
    const available = Math.max(20, width - role.length - 4);
    if (text.length > available) {
      text = `${text.slice(0, available - 1).trimEnd()}...`;
    }
    return `${role.padStart(12, " ")}  ${text}`;
  }).join(os.EOL);
}

function previewDocumentContent(session, entries) {
  const lines = [
    "Codex Radar Transcript Preview",
    `Session: ${session.session_id || "unknown"}`,
    `Project: ${session.project || "-"}`,
    `Status: ${session.display_status || session.status || "-"}`,
    `Last seen: ${session.last_seen_at || "-"}`,
    "",
  ];
  const skim = formatSkim(entries);
  lines.push(skim || "No previewable transcript text found.");
  return lines.join(os.EOL);
}

module.exports = {
  collectTexts,
  findRole,
  formatSkim,
  parseJsonl,
  previewDocumentContent,
  redact,
  skimTranscript,
};
