const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildSessionPreviewModel,
  markdownToSafeHtml,
  skimTranscriptText,
} = require("../src/transcriptPreview");

test("skims only user and Codex transcript messages with redaction", () => {
  const text = [
    JSON.stringify({ role: "user", content: [{ text: "hello" }] }),
    "{invalid json",
    JSON.stringify(["not previewable"]),
    JSON.stringify({ author: { role: "assistant" }, content: [{ text: "token=supersecret" }] }),
    JSON.stringify({ type: "event", message: `${os.homedir()}/private/file` }),
    JSON.stringify({ role: "tool", content: [{ text: "internal tool output" }] }),
  ].join("\n");

  const entries = skimTranscriptText(text, { limit: 0, homeDir: os.homedir() });

  assert.deepEqual(entries.map(({ role, label, text }) => ({ role, label, text })), [
    { role: "user", label: "You", text: "hello" },
    { role: "assistant", label: "Codex", text: "[REDACTED]" },
  ]);
});

test("limits transcript preview to latest entries", () => {
  const text = [
    JSON.stringify({ role: "user", content: [{ text: "first" }] }),
    JSON.stringify({ role: "assistant", content: [{ text: "second" }] }),
    JSON.stringify({ role: "user", content: [{ text: "third" }] }),
  ].join("\n");

  assert.deepEqual(skimTranscriptText(text, { limit: 2 }).map(({ role, text }) => ({ role, text })), [
    { role: "assistant", text: "second" },
    { role: "user", text: "third" },
  ]);
});

test("extracts conversation messages from nested Codex transcript shapes", () => {
  const text = [
    JSON.stringify({
      type: "response_item",
      item: {
        role: "assistant",
        content: [{ type: "output_text", text: "## Done\n- wrote `code`" }],
      },
    }),
    JSON.stringify({
      type: "event_msg",
      message: {
        role: "user",
        content: [{ type: "input_text", text: "show **summary**" }],
      },
    }),
    JSON.stringify({
      type: "tool_result",
      message: { role: "tool", content: [{ type: "text", text: "hidden" }] },
    }),
  ].join("\n");

  const entries = skimTranscriptText(text, { limit: 0 });

  assert.deepEqual(entries.map(({ role, text }) => ({ role, text })), [
    { role: "assistant", text: "## Done\n- wrote `code`" },
    { role: "user", text: "show **summary**" },
  ]);
  assert.match(entries[0].html, /<h4>Done<\/h4>/);
  assert.match(entries[0].html, /<code>code<\/code>/);
  assert.match(entries[1].html, /<strong>summary<\/strong>/);
});

test("renders markdown as safe html", () => {
  const html = markdownToSafeHtml([
    "# Heading",
    "",
    "hello **bold** and `code`",
    "",
    "- one",
    "- <script>alert(1)</script>",
    "",
    "```",
    "<unsafe>",
    "```",
  ].join("\n"));

  assert.match(html, /<h3>Heading<\/h3>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("builds a session preview model without exposing transcript paths", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-preview-"));
  const transcriptPath = path.join(tmp, "transcript.jsonl");
  fs.writeFileSync(
    transcriptPath,
    `${JSON.stringify({ role: "assistant", content: [{ text: "secret=hidden_value done" }] })}\n`,
    "utf8",
  );

  const model = buildSessionPreviewModel({
    session_id: "session-1",
    project: "project-a",
    display_status: "done",
    last_seen_at: "2026-07-05T00:00:00+09:00",
    transcript_path: transcriptPath,
    last_assistant_message: "open token=also_hidden",
  }, {
    nowMs: Date.parse("2026-07-05T00:10:00+09:00"),
    homeDir: os.homedir(),
  });

  assert.equal(model.project, "project-a");
  assert.equal(model.status, "Done");
  assert.equal(model.lastSeen, "10m ago");
  assert.equal(model.transcriptEntries[0].text, "[REDACTED] done");
  assert.equal(model.transcriptEntries[0].label, "Codex");
  assert.equal(model.summary, "open [REDACTED]");
  assert.equal(JSON.stringify(model).includes(transcriptPath), false);
});

test("uses generic transcript errors so private paths are not displayed", () => {
  const missingPath = path.join(os.tmpdir(), "codex-radar-missing-private-transcript.jsonl");
  const model = buildSessionPreviewModel({
    session_id: "session-1",
    display_status: "done",
    transcript_path: missingPath,
  });

  assert.equal(model.transcriptEntries.length, 0);
  assert.equal(model.transcriptMessage, "Transcript file is not available on this host.");
  assert.equal(JSON.stringify(model).includes(missingPath), false);
});
