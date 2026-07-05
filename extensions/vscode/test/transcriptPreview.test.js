const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildSessionPreviewModel,
  skimTranscriptText,
} = require("../src/transcriptPreview");

test("skims transcript JSONL text with role extraction and redaction", () => {
  const text = [
    JSON.stringify({ role: "user", content: [{ text: "hello" }] }),
    "{invalid json",
    JSON.stringify(["not previewable"]),
    JSON.stringify({ author: { role: "assistant" }, content: [{ text: "token=supersecret" }] }),
    JSON.stringify({ type: "event", message: `${os.homedir()}/private/file` }),
  ].join("\n");

  const entries = skimTranscriptText(text, { limit: 0, homeDir: os.homedir() });

  assert.deepEqual(entries, [
    { role: "user", text: "hello" },
    { role: "assistant", text: "[REDACTED]" },
    { role: "event", text: "~/private/file" },
  ]);
});

test("limits transcript preview to latest entries", () => {
  const text = [
    JSON.stringify({ role: "user", content: [{ text: "first" }] }),
    JSON.stringify({ role: "assistant", content: [{ text: "second" }] }),
    JSON.stringify({ role: "user", content: [{ text: "third" }] }),
  ].join("\n");

  assert.deepEqual(skimTranscriptText(text, { limit: 2 }), [
    { role: "assistant", text: "second" },
    { role: "user", text: "third" },
  ]);
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
