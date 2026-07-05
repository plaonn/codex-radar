const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  compactText,
  redactText,
  relativeTimeText,
  shortSessionId,
  statusText,
  truncateText,
} = require("./sessionViewModel");

const TEXT_PART_TYPES = new Set(["text", "input_text", "output_text", "markdown"]);
const TRANSCRIPT_FILE_LIMIT = 5000;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeUrl(value) {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? escapeHtml(url) : "";
}

function inlineMarkdownToHtml(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label, url) => {
    const safeUrl = sanitizeUrl(url);
    return safeUrl ? `<a href="${safeUrl}">${label}</a>` : label;
  });
  return html;
}

function isBlockStart(line) {
  return /^(#{1,4}\s+|[-*]\s+|\d+\.\s+|>\s?|```)/.test(line);
}

function renderParagraph(lines) {
  return `<p>${inlineMarkdownToHtml(lines.join(" "))}</p>`;
}

function renderList(lines, ordered) {
  const tag = ordered ? "ol" : "ul";
  const marker = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
  const items = lines.map((line) => `<li>${inlineMarkdownToHtml(line.replace(marker, ""))}</li>`).join("");
  return `<${tag}>${items}</${tag}>`;
}

function markdownToSafeHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = Math.min(4, heading[1].length + 2);
      blocks.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(lines[index]);
        index += 1;
      }
      blocks.push(renderList(items, false));
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index]);
        index += 1;
      }
      blocks.push(renderList(items, true));
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote>${renderParagraph(quote)}</blockquote>`);
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(renderParagraph(paragraph));
  }

  return blocks.join("");
}

function normalizeConversationRole(role) {
  const value = String(role || "").toLowerCase();
  if (value === "user" || value === "human") {
    return "user";
  }
  if (value === "assistant" || value === "codex" || value === "agent") {
    return "assistant";
  }
  return "";
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
  return "";
}

function candidateMessages(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return [];
  }
  return [
    item,
    item.message,
    item.entry,
    item.item,
    item.data,
    item.record,
  ].filter((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate));
}

function appendText(found, value, options) {
  const maxTexts = options.maxTexts ?? 8;
  if (found.length >= maxTexts) {
    return;
  }
  const text = redactText(String(value || ""), options)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (text) {
    found.push(text);
  }
}

function collectContentText(found, value, options = {}) {
  if (found.length >= (options.maxTexts ?? 8)) {
    return;
  }
  if (typeof value === "string") {
    appendText(found, value, options);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      collectContentText(found, child, options);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }

  const partType = String(value.type || "");
  if (partType && !TEXT_PART_TYPES.has(partType)) {
    return;
  }
  for (const key of ["text", "content", "message"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      collectContentText(found, value[key], options);
    }
  }
}

function collectConversationTexts(message, options = {}) {
  const found = [];
  for (const key of ["content", "text", "message", "summary"]) {
    if (Object.prototype.hasOwnProperty.call(message, key)) {
      collectContentText(found, message[key], options);
    }
  }
  return found;
}

function conversationEntriesFromItem(item, options = {}) {
  const entries = [];
  for (const candidate of candidateMessages(item)) {
    const role = normalizeConversationRole(findRole(candidate));
    if (!role) {
      continue;
    }
    const texts = collectConversationTexts(candidate, options);
    for (const text of texts) {
      entries.push({
        role,
        label: role === "assistant" ? "Codex" : "You",
        text,
        html: markdownToSafeHtml(text),
      });
    }
    if (entries.length) {
      return entries;
    }
  }
  return entries;
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
    entries.push(...conversationEntriesFromItem(item, options));
  }

  const limit = options.limit ?? 30;
  return limit > 0 ? entries.slice(-limit) : entries;
}

function codexHome(options = {}) {
  return path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
}

function transcriptSearchRoots(options = {}) {
  const home = codexHome(options);
  return [path.join(home, "sessions"), path.join(home, "archived_sessions")];
}

function isSearchableSessionId(sessionId) {
  const value = String(sessionId || "");
  return Boolean(value && value !== "unknown" && !value.startsWith("unknown:") && !/[\\/]/.test(value));
}

function candidateTranscriptFiles(root, sessionId, options = {}) {
  const matches = [];
  const stack = [root];
  let visitedFiles = 0;
  const maxFiles = options.maxTranscriptFiles ?? TRANSCRIPT_FILE_LIMIT;

  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      visitedFiles += 1;
      if (visitedFiles > maxFiles) {
        return matches;
      }
      if (entry.name.endsWith(".jsonl") && entry.name.includes(sessionId)) {
        matches.push(fullPath);
      }
    }
  }

  return matches;
}

function newestExistingFile(paths) {
  let selected = "";
  let selectedMtime = -1;
  for (const filePath of paths) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile() && stat.mtimeMs > selectedMtime) {
        selected = filePath;
        selectedMtime = stat.mtimeMs;
      }
    } catch {
      // Ignore disappearing files while scanning host-local Codex state.
    }
  }
  return selected;
}

function resolveTranscriptPath(session, options = {}) {
  const explicitPath = String(session?.transcript_path || "");
  if (explicitPath) {
    return explicitPath;
  }

  const sessionId = String(session?.session_id || "");
  if (!isSearchableSessionId(sessionId)) {
    return "";
  }

  const candidates = transcriptSearchRoots(options).flatMap((root) => (
    candidateTranscriptFiles(root, sessionId, options)
  ));
  return newestExistingFile(candidates);
}

function cachedSummaryEntries(session, options = {}) {
  const text = redactText(String(session?.last_assistant_message || ""), options)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (!text) {
    return [];
  }
  return [{
    role: "assistant",
    label: "Codex",
    text,
    html: markdownToSafeHtml(text),
    source: "cache",
  }];
}

function transcriptFallback(session, message, options = {}) {
  return {
    entries: cachedSummaryEntries(session, options),
    message,
  };
}

function readTranscriptEntries(session, options = {}) {
  const transcriptPath = resolveTranscriptPath(session, options);
  if (!transcriptPath) {
    return transcriptFallback(
      session,
      session?.last_assistant_message
        ? "Transcript file was not found on the extension host. Showing the cached latest Codex summary."
        : "No transcript file found for this session on the extension host.",
      options,
    );
  }

  try {
    const text = fs.readFileSync(transcriptPath, "utf8");
    const entries = skimTranscriptText(text, options);
    return {
      entries: entries.length ? entries : cachedSummaryEntries(session, options),
      message: entries.length
        ? ""
        : session?.last_assistant_message
          ? "No user/Codex messages were found in the transcript preview. Showing the cached latest Codex summary."
          : "No user/Codex messages found in the transcript preview.",
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return transcriptFallback(
        session,
        session?.last_assistant_message
          ? "Transcript file is not available on this host. Showing the cached latest Codex summary."
          : "Transcript file is not available on this host.",
        options,
      );
    }
    return transcriptFallback(
      session,
      session?.last_assistant_message
        ? "Could not read transcript preview. Showing the cached latest Codex summary."
        : "Could not read transcript preview.",
      options,
    );
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
  cachedSummaryEntries,
  collectConversationTexts,
  conversationEntriesFromItem,
  escapeHtml,
  findRole,
  markdownToSafeHtml,
  readTranscriptEntries,
  resolveTranscriptPath,
  skimTranscriptText,
};
