const assert = require("node:assert/strict");
const test = require("node:test");

const {
  codexResumeTerminalOptions,
  resumableSessionId,
} = require("../src/codexCliTerminal");

test("builds a terminal launch with exact Codex resume argv and raw session cwd", () => {
  const sessionId = "019f0000-1111-7222-8333-444444444444";
  const options = codexResumeTerminalOptions({
    session_id: sessionId,
    cwd: "/worktrees/project with spaces",
  }, "/opt/Codex CLI/bin/codex");

  assert.deepEqual(options, {
    name: "Codex: 019f0000-111",
    shellPath: "/opt/Codex CLI/bin/codex",
    shellArgs: ["resume", sessionId],
    cwd: "/worktrees/project with spaces",
  });
});

test("falls back to the integrated terminal default cwd when session cwd is missing", () => {
  const options = codexResumeTerminalOptions({
    session_id: "session-without-cwd",
  }, "");

  assert.deepEqual(options, {
    name: "Codex: session-with",
    shellPath: "codex",
    shellArgs: ["resume", "session-without-cwd"],
  });
  assert.equal(Object.prototype.hasOwnProperty.call(options, "cwd"), false);
});

test("rejects placeholder session identities without inferring another target", () => {
  assert.equal(resumableSessionId({ session_id: "unknown" }), "");
  assert.equal(resumableSessionId({ session_id: "unknown:abc" }), "");
  assert.equal(codexResumeTerminalOptions({}, "codex"), null);
});
