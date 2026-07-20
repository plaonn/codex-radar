const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildSessionPreviewModel,
  buildSessionPreviewModelFromExport,
  buildSessionDisplayFields,
  DEFAULT_PREVIEW_ENTRY_LIMIT,
  dedupeAdjacentEntries,
  markdownToSafeHtml,
  normalizeRolloutTimestamp,
  resolveTranscriptPathInfo,
  resolveTranscriptPath,
  sessionDisplayFieldsFromEntries,
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

test("keeps the earliest valid top-level timestamp when duplicate wrappers merge", () => {
  const text = [
    JSON.stringify({
      timestamp: "invalid",
      type: "event_msg",
      payload: {
        type: "user_message",
        message: "same prompt",
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-14T09:02:00+09:00",
      type: "event_msg",
      payload: {
        type: "user_message",
        message: "same prompt",
        timestamp: "2020-01-01T00:00:00Z",
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-14T08:59:00+09:00",
      role: "user",
      content: "same prompt",
    }),
  ].join("\n");

  const entries = skimTranscriptText(text, { limit: 0 });

  assert.equal(normalizeRolloutTimestamp("2026-07-14T08:59:00+09:00"), "2026-07-13T23:59:00.000Z");
  assert.deepEqual(entries.map(({ role, text: entryText, recordedAt }) => ({
    role,
    text: entryText,
    recordedAt,
  })), [{
    role: "user",
    text: "same prompt",
    recordedAt: "2026-07-13T23:59:00.000Z",
  }]);
});

test("keeps direct and shared-export preview timestamp semantics aligned", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-preview-time-parity-"));
  try {
    const transcriptPath = path.join(tmp, "rollout-session-1.jsonl");
    fs.writeFileSync(transcriptPath, JSON.stringify({
      timestamp: "2026-07-14T09:00:00+09:00",
      role: "assistant",
      content: "finished",
    }));
    const session = {
      session_id: "session-1",
      transcript_path: transcriptPath,
      display_status: "done",
    };

    const direct = buildSessionPreviewModel(session);
    const exported = buildSessionPreviewModelFromExport(session, {
      messages: [{
        role: "assistant",
        text: "finished",
        recorded_at: "2026-07-14T00:00:00+00:00",
      }],
    });

    assert.equal(direct.transcriptEntries[0].text, exported.transcriptEntries[0].text);
    assert.equal(
      Date.parse(direct.transcriptEntries[0].recordedAt),
      Date.parse(exported.transcriptEntries[0].recordedAt),
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("derives display title from user request before first Codex message and snippet from last activity", () => {
  const text = [
    JSON.stringify({
      role: "user",
      content: [{
        text: [
          "<environment_context><cwd>/private</cwd></environment_context>",
          "# Selected text:",
          "internal context",
          "## My request for Codex:",
          "Use transcript-derived display fields",
          "<image path=\"/tmp/private.png\">hidden</image>",
        ].join("\n"),
      }],
    }),
    JSON.stringify({ role: "assistant", content: [{ text: "I will inspect the current model." }] }),
    JSON.stringify({ role: "tool", content: [{ text: "raw command output" }] }),
    JSON.stringify({ role: "user", content: [{ text: "그리고 snippet은 마지막 메시지를 보여줘" }] }),
  ].join("\n");
  const entries = skimTranscriptText(text, { limit: 0 });
  const fields = sessionDisplayFieldsFromEntries({
    session_id: "session-1",
    project: "codex-radar",
    display_status: "running",
  }, entries);

  assert.equal(fields.title, "Use transcript-derived display fields");
  assert.equal(fields.snippetSpeaker, "You");
  assert.equal(fields.snippetRole, "user");
  assert.equal(fields.snippetText, "그리고 snippet은 마지막 메시지를 보여줘");
});

test("unwraps Codex name-tag title messages before rendering cards", () => {
  const entries = skimTranscriptText([
    JSON.stringify({ role: "user", content: [{ text: "<name>Review sidebar titles</name>" }] }),
    JSON.stringify({ role: "assistant", content: [{ text: "Review sidebar titles" }] }),
  ].join("\n"), { limit: 0 });
  const fields = sessionDisplayFieldsFromEntries({
    session_id: "session-1",
    project: "codex-radar",
    display_status: "done",
  }, entries);

  assert.equal(fields.title, "Review sidebar titles");
  assert.equal(fields.snippetText, "");
  assert.equal(fields.snippetSpeaker, "");
});

test("builds display fields from transcript path without leaking tool output", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-display-fields-"));
  const transcriptPath = path.join(tmp, "transcript.jsonl");
  fs.writeFileSync(transcriptPath, [
    JSON.stringify({ role: "user", content: [{ text: "Summarize this thread" }] }),
    JSON.stringify({ role: "assistant", content: [{ text: "Working on it" }] }),
    JSON.stringify({ type: "tool_result", payload: { role: "tool", content: [{ type: "text", text: "hidden" }] } }),
    JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "token=hidden_value done" } }),
  ].join("\n"), "utf8");

  const fields = buildSessionDisplayFields({
    session_id: "session-1",
    project: "codex-radar",
    display_status: "done",
    transcript_path: transcriptPath,
  }, {
    resolveTranscriptPathInfo: () => ({ path: transcriptPath, source: "explicit" }),
  });

  assert.equal(fields.title, "Summarize this thread");
  assert.equal(fields.snippetSpeaker, "Codex");
  assert.equal(fields.snippetText, "[REDACTED] done");
  assert.equal(JSON.stringify(fields).includes("hidden"), false);
});

test("uses only sanitized identity fields for export-mode dashboard display", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-export-display-"));
  try {
    const transcriptPath = path.join(tmp, "rollout-session-1.jsonl");
    fs.writeFileSync(transcriptPath, [
      JSON.stringify({ role: "user", content: "private direct title" }),
      JSON.stringify({ role: "assistant", content: "private direct summary" }),
    ].join("\n"));
    const session = {
      session_id: "session-1",
      project: "radar",
      transcript_path: transcriptPath,
      read_source: "export",
    };

    const exported = buildSessionDisplayFields(session);
    const direct = buildSessionDisplayFields({ ...session, read_source: "direct" });

    assert.equal(exported.title, "radar - session-1");
    assert.equal(exported.snippet, "");
    assert.match(direct.title, /private direct title/);
    assert.equal(JSON.stringify(exported).includes("private direct"), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
  assert.equal(model.status, "Reply ready");
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
