const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildSessionPreviewModel,
  DEFAULT_PREVIEW_ENTRY_LIMIT,
  dedupeAdjacentEntries,
  markdownToSafeHtml,
  resolveTranscriptPathInfo,
  resolveTranscriptPath,
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

test("defaults transcript preview to a larger messenger-style history window", () => {
  const text = Array.from({ length: DEFAULT_PREVIEW_ENTRY_LIMIT + 5 }, (_value, index) => (
    JSON.stringify({ role: index % 2 ? "assistant" : "user", content: [{ text: `message-${index}` }] })
  )).join("\n");
  const entries = skimTranscriptText(text);

  assert.equal(DEFAULT_PREVIEW_ENTRY_LIMIT, 120);
  assert.equal(entries.length, DEFAULT_PREVIEW_ENTRY_LIMIT);
  assert.equal(entries[0].text, "message-5");
  assert.equal(entries.at(-1).text, `message-${DEFAULT_PREVIEW_ENTRY_LIMIT + 4}`);
});

test("extracts conversation messages from nested Codex transcript shapes", () => {
  const text = [
    JSON.stringify({
      type: "response_item",
      payload: {
        role: "assistant",
        type: "message",
        content: [{ type: "output_text", text: "## Done\n- wrote `code`" }],
      },
    }),
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "user_message",
        message: "show **summary**",
      },
    }),
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: "done from event",
      },
    }),
    JSON.stringify({
      type: "tool_result",
      payload: { role: "tool", content: [{ type: "text", text: "hidden" }] },
    }),
  ].join("\n");

  const entries = skimTranscriptText(text, { limit: 0 });

  assert.deepEqual(entries.map(({ role, text }) => ({ role, text })), [
    { role: "assistant", text: "## Done\n- wrote `code`" },
    { role: "user", text: "show **summary**" },
    { role: "assistant", text: "done from event" },
  ]);
  assert.match(entries[0].html, /<h4>Done<\/h4>/);
  assert.match(entries[0].html, /<code>code<\/code>/);
  assert.match(entries[1].html, /<strong>summary<\/strong>/);
});

test("dedupes adjacent duplicated user and Codex transcript entries", () => {
  const text = [
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "same prompt" }],
      },
    }),
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "user_message",
        message: "same prompt",
      },
    }),
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: "same answer",
      },
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "same answer" }],
      },
    }),
  ].join("\n");

  assert.deepEqual(skimTranscriptText(text, { limit: 0 }).map(({ role, text }) => ({ role, text })), [
    { role: "user", text: "same prompt" },
    { role: "assistant", text: "same answer" },
  ]);
  assert.deepEqual(dedupeAdjacentEntries([
    { role: "user", text: "same prompt" },
    { role: "user", text: "same prompt" },
    { role: "assistant", text: "same prompt" },
  ]).map(({ role, text }) => ({ role, text })), [
    { role: "user", text: "same prompt" },
    { role: "assistant", text: "same prompt" },
  ]);
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

test("falls back to Codex transcript store when session cache has no transcript path", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-codex-home-"));
  const sessionId = "019f30bd-2c6e-7000-8000-previewfallback";
  const transcriptDir = path.join(tmp, "sessions", "2026", "07", "05");
  fs.mkdirSync(transcriptDir, { recursive: true });
  const transcriptPath = path.join(transcriptDir, `rollout-2026-07-05T00-00-00-${sessionId}.jsonl`);
  fs.writeFileSync(
    transcriptPath,
    `${JSON.stringify({ role: "user", content: [{ text: "please summarize" }] })}\n`,
    "utf8",
  );

  const session = {
    session_id: sessionId,
    display_status: "done",
  };
  const model = buildSessionPreviewModel(session, { codexHome: tmp });

  assert.equal(resolveTranscriptPath(session, { codexHome: tmp }), transcriptPath);
  assert.deepEqual(model.transcriptEntries.map(({ role, text }) => ({ role, text })), [
    { role: "user", text: "please summarize" },
  ]);
  assert.equal(JSON.stringify(model).includes(transcriptPath), false);
});

test("uses archived transcript with matching file name when cached transcript path moved", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-archived-codex-home-"));
  const transcriptName = "rollout-2026-07-05T00-00-00-019f30bd-2c6e-7000-8000-archived.jsonl";
  const missingPath = path.join(tmp, "sessions", "2026", "07", "05", transcriptName);
  const archivedDir = path.join(tmp, "archived_sessions");
  const archivedPath = path.join(archivedDir, transcriptName);
  fs.mkdirSync(archivedDir, { recursive: true });
  fs.writeFileSync(
    archivedPath,
    `${JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "archived answer" } })}\n`,
    "utf8",
  );

  const session = {
    session_id: "019f30bd-2c6e-7000-8000-archived",
    display_status: "done",
    transcript_path: missingPath,
  };
  const model = buildSessionPreviewModel(session, { codexHome: tmp });

  assert.deepEqual(resolveTranscriptPathInfo(session, { codexHome: tmp }), {
    path: archivedPath,
    source: "archived",
  });
  assert.equal(model.transcriptMessage, "Showing archived transcript from the host-local Codex store.");
  assert.deepEqual(model.transcriptEntries.map(({ role, text }) => ({ role, text })), [
    { role: "assistant", text: "archived answer" },
  ]);
  assert.equal(JSON.stringify(model).includes(archivedPath), false);
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

test("falls back to cached assistant summary when transcript is unavailable", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-empty-codex-home-"));
  const model = buildSessionPreviewModel({
    session_id: "019f30bd-2c6e-7000-8000-cachefallback",
    display_status: "done",
    last_assistant_message: "## Cached\nsummary token=hidden_value",
  }, {
    codexHome: tmp,
  });

  assert.equal(model.transcriptEntries.length, 1);
  assert.equal(model.transcriptEntries[0].label, "Codex");
  assert.equal(model.transcriptEntries[0].text, "## Cached\nsummary [REDACTED]");
  assert.match(model.transcriptEntries[0].html, /<h4>Cached<\/h4>/);
  assert.equal(
    model.transcriptMessage,
    "No transcript path is recorded for this Radar session cache item. Showing the cached latest Codex summary.",
  );
  assert.equal(JSON.stringify(model).includes(tmp), false);
});

test("uses a generic message when no transcript path or fallback file exists", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-empty-codex-home-"));
  const model = buildSessionPreviewModel({
    session_id: "019f30bd-2c6e-7000-8000-missingfallback",
    display_status: "done",
  }, {
    codexHome: tmp,
  });

  assert.equal(model.transcriptEntries.length, 0);
  assert.equal(model.transcriptMessage, "No transcript path is recorded for this Radar session cache item.");
  assert.equal(JSON.stringify(model).includes(tmp), false);
});
