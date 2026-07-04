const assert = require("node:assert/strict");
const test = require("node:test");

const { officialCodexThreadUriString } = require("../src/codexLink");

test("builds an official Codex extension URI for a session id", () => {
  assert.equal(
    officialCodexThreadUriString({
      session_id: "019f2d7c-8b99-7341-88d4-476fed948963",
    }),
    "vscode://openai.chatgpt/local/019f2d7c-8b99-7341-88d4-476fed948963",
  );
});

test("URL-encodes session ids before passing them to the official extension route", () => {
  assert.equal(
    officialCodexThreadUriString({ session_id: "session id/with spaces" }),
    "vscode://openai.chatgpt/local/session%20id%2Fwith%20spaces",
  );
});

test("does not build official Codex URIs for missing or placeholder session ids", () => {
  assert.equal(officialCodexThreadUriString({}), null);
  assert.equal(officialCodexThreadUriString({ session_id: "unknown" }), null);
  assert.equal(officialCodexThreadUriString({ session_id: "unknown:2026-07-04" }), null);
});
