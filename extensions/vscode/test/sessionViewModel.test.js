const assert = require("node:assert/strict");
const test = require("node:test");

const {
  attentionCount,
  projectLabel,
  sessionDescription,
  sessionLabel,
  shortSessionId,
} = require("../src/sessionViewModel");

test("shortens long session ids for scan-friendly rows", () => {
  assert.equal(shortSessionId("019f2830-12e4-7fe0-beee-92df30259c6e"), "019f2830-12e");
  assert.equal(shortSessionId("short-id"), "short-id");
  assert.equal(shortSessionId(""), "unknown");
});

test("formats session rows without transcript content", () => {
  const session = {
    session_id: "session-approval",
    display_status: "waiting_approval",
    last_event_name: "PermissionRequest",
    model: "gpt-5",
    last_seen_at: "2026-07-04T00:00:00+00:00",
  };

  assert.equal(sessionLabel(session), "waiting_approval session-appr");
  assert.equal(
    sessionDescription(session),
    "PermissionRequest | gpt-5 | 2026-07-04T00:00:00+00:00",
  );
});

test("summarizes project attention in group labels", () => {
  const sessions = [
    { display_status: "waiting_approval" },
    { display_status: "done" },
    { display_status: "stale" },
  ];

  assert.equal(attentionCount(sessions), 2);
  assert.equal(projectLabel("codex-radar", sessions), "codex-radar (2 attention / 3 total)");
  assert.equal(projectLabel("idle-project", [{ display_status: "done" }]), "idle-project (1)");
});
