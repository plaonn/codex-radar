const assert = require("node:assert/strict");
const test = require("node:test");

const {
  attentionBadge,
  attentionCount,
  projectLabel,
  relativeTimeText,
  sessionDescription,
  sessionLabel,
  sessionTooltip,
  shortSessionId,
  statusText,
} = require("../src/sessionViewModel");

test("shortens long session ids for scan-friendly rows", () => {
  assert.equal(shortSessionId("019f2830-12e4-7fe0-beee-92df30259c6e"), "019f2830-12e");
  assert.equal(shortSessionId("short-id"), "short-id");
  assert.equal(shortSessionId(""), "unknown");
});

test("formats session rows without transcript content", () => {
  const session = {
    current_tool: "Bash",
    session_id: "session-approval",
    display_status: "waiting_approval",
    last_event_name: "PermissionRequest",
    model: "gpt-5",
    last_seen_at: "2026-07-04T00:00:00+00:00",
  };

  assert.equal(statusText("waiting_approval"), "Waiting approval");
  assert.equal(sessionLabel(session), "Waiting approval - session-appr");
  assert.equal(
    sessionDescription(session, { nowMs: Date.parse("2026-07-04T00:07:00+00:00") }),
    "Bash | PermissionRequest | gpt-5 | 7m ago",
  );
  assert.equal(sessionTooltip(session, { nowMs: Date.parse("2026-07-04T00:07:00+00:00") }), [
    "Project: -",
    "Status: Waiting approval",
    "Last event: PermissionRequest",
    "Last seen: 7m ago",
    "Model: gpt-5",
    "Current tool: Bash",
  ].join("\n"));
});

test("formats relative session times for compact scanning", () => {
  const nowMs = Date.parse("2026-07-04T12:00:00+00:00");

  assert.equal(relativeTimeText("2026-07-04T12:00:00+00:00", { nowMs }), "now");
  assert.equal(relativeTimeText("2026-07-04T11:59:00+00:00", { nowMs }), "1m ago");
  assert.equal(relativeTimeText("2026-07-04T10:00:00+00:00", { nowMs }), "2h ago");
  assert.equal(relativeTimeText("2026-07-02T12:00:00+00:00", { nowMs }), "2d ago");
  assert.equal(relativeTimeText("2026-06-20T12:00:00+00:00", { nowMs }), "2026-06-20");
  assert.equal(relativeTimeText("not-a-date", { nowMs }), "");
});

test("summarizes project attention in group labels", () => {
  const sessions = [
    { display_status: "waiting_approval" },
    { display_status: "done" },
    { display_status: "stale" },
  ];

  assert.equal(attentionCount(sessions), 2);
  assert.equal(projectLabel("codex-radar", sessions), "codex-radar - 2 attention / 3");
  assert.equal(projectLabel("idle-project", [{ display_status: "done" }]), "idle-project (1)");
});

test("builds an attention badge from attention statuses only", () => {
  const sessions = [
    { display_status: "waiting_approval" },
    { display_status: "running" },
    { display_status: "tool_running" },
    { display_status: "stale" },
    { display_status: "done" },
    { display_status: "unknown" },
  ];

  assert.deepEqual(attentionBadge(sessions), {
    value: 4,
    tooltip: "4 attention sessions",
  });
  assert.equal(attentionBadge([{ display_status: "done" }]), undefined);
  assert.deepEqual(attentionBadge([{ display_status: "stale" }]), {
    value: 1,
    tooltip: "1 attention session",
  });
});
