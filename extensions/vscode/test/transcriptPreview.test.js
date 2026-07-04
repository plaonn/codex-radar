const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  formatSkim,
  previewDocumentContent,
  skimTranscript,
} = require("../src/transcriptPreview");

function writeTranscript(transcriptPath, lines) {
  fs.writeFileSync(transcriptPath, `${lines.join("\n")}\n`, "utf8");
}

test("skims transcript text and redacts secret-like values", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-vscode-preview-"));
  try {
    const transcriptPath = path.join(tmp, "transcript.jsonl");
    writeTranscript(transcriptPath, [
      JSON.stringify({ role: "user", content: [{ text: "hello" }] }),
      JSON.stringify({ role: "assistant", content: [{ text: "token=supersecret" }] }),
    ]);

    const output = formatSkim(skimTranscript(transcriptPath));

    assert.match(output, /hello/);
    assert.match(output, /\[REDACTED\]/);
    assert.doesNotMatch(output, /supersecret/);
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }
});

test("skips invalid JSONL and non-object rows", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-vscode-preview-"));
  try {
    const transcriptPath = path.join(tmp, "transcript.jsonl");
    writeTranscript(transcriptPath, [
      JSON.stringify({ role: "user", content: [{ text: "before" }] }),
      "{invalid json",
      JSON.stringify(["list entries should not be previewed"]),
      JSON.stringify("string entries should not be previewed"),
      JSON.stringify({ role: "assistant", content: [{ text: "after" }] }),
    ]);

    assert.deepEqual(skimTranscript(transcriptPath), [
      ["user", "before"],
      ["assistant", "after"],
    ]);
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }
});

test("redacts home paths in preview text", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-vscode-preview-"));
  try {
    const transcriptPath = path.join(tmp, "transcript.jsonl");
    const homePath = path.join(os.homedir(), "private", "transcript.jsonl");
    writeTranscript(transcriptPath, [
      JSON.stringify({ role: "assistant", content: [{ text: `open ${homePath}` }] }),
    ]);

    const output = formatSkim(skimTranscript(transcriptPath));

    assert.match(output, /~\/private\/transcript\.jsonl/);
    assert.doesNotMatch(output, new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }
});

test("returns latest previewable entries by default limit", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-vscode-preview-"));
  try {
    const transcriptPath = path.join(tmp, "transcript.jsonl");
    writeTranscript(transcriptPath, [
      JSON.stringify({ role: "user", content: [{ text: "first" }] }),
      JSON.stringify({ role: "assistant", content: [{ text: "second" }] }),
      JSON.stringify({ role: "user", content: [{ text: "third" }] }),
    ]);

    assert.deepEqual(skimTranscript(transcriptPath, { limit: 2 }), [
      ["assistant", "second"],
      ["user", "third"],
    ]);
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }
});

test("formats readonly preview content without transcript path", () => {
  const session = {
    session_id: "session-1",
    project: "codex-radar",
    display_status: "waiting_approval",
    last_seen_at: "2026-07-04T00:00:00+00:00",
    transcript_path: "/private/transcript.jsonl",
  };

  const output = previewDocumentContent(session, [["user", "identify this session"]]);

  assert.match(output, /Codex Radar Transcript Preview/);
  assert.match(output, /session-1/);
  assert.match(output, /identify this session/);
  assert.doesNotMatch(output, /\/private\/transcript\.jsonl/);
});
