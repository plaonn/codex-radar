const assert = require("node:assert/strict");
const test = require("node:test");

const {
  attentionBadge,
  attentionCount,
  compactText,
  projectLabel,
  relativeTimeText,
  redactText,
  sessionDescription,
  sessionIconId,
  sessionLabel,
  sessionSnippet,
  sessionTitle,
  sessionTooltip,
  shortSessionId,
  statusText,
  truncateText,
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
    is_attention: true,
    last_event_name: "PermissionRequest",
    last_assistant_message: "I need permission to run the command.",
    model: "gpt-5",
    last_seen_at: "2026-07-04T00:00:00+00:00",
  };

  assert.equal(statusText("waiting_approval"), "Waiting approval");
  assert.equal(sessionLabel(session), "session-appr - I need permission to run the command.");
  assert.equal(
    sessionDescription(session, { nowMs: Date.parse("2026-07-04T00:07:00+00:00") }),
    "Waiting approval | Bash | gpt-5 | 7m ago",
  );
  assert.equal(
    sessionDescription(
      { ...session, project: "codex-radar" },
      { nowMs: Date.parse("2026-07-04T00:07:00+00:00"), showProject: true },
    ),
    "codex-radar | Waiting approval | Bash | gpt-5 | 7m ago",
  );
  assert.equal(sessionTooltip(session, { nowMs: Date.parse("2026-07-04T00:07:00+00:00") }), [
    "Project: -",
    "Status: Waiting approval",
    "Read: -",
    "Last event: PermissionRequest",
    "Last seen: 7m ago",
    "Model: gpt-5",
    "Current tool: Bash",
    "Session: session-appr",
  ].join("\n"));
});

test("builds human-readable title and redacted snippet from session cache", () => {
  const session = {
    display_status: "done",
    session_id: "019f2830-12e4-7fe0-beee-92df30259c6e",
    last_assistant_message: "token=supersecret open /Users/example/private/file",
  };

  assert.equal(compactText("  hello\n\nworld  "), "hello world");
  assert.equal(truncateText("abcdef", 4), "abc...");
  assert.equal(redactText("token=supersecret", { homeDir: "/Users/example" }), "[REDACTED]");
  assert.equal(
    sessionSnippet(session, { homeDir: "/Users/example" }),
    "[REDACTED] open ~/private/file",
  );
  assert.equal(
    sessionTitle(session, { homeDir: "/Users/example" }),
    "019f2830-12e - [REDACTED] open ~/private/file",
  );
  assert.equal(
    sessionTitle({ ...session, thread_title: "  Release\nreadiness  " }),
    "Release readiness",
  );
  assert.equal(sessionTitle({ display_status: "running" }), "unknown - Running thread");
});

test("makes done read state visible in row descriptions", () => {
  const base = {
    display_status: "done",
    last_seen_at: "2026-07-04T00:00:00+00:00",
  };
  const now = { nowMs: Date.parse("2026-07-04T00:07:00+00:00") };

  assert.equal(sessionDescription({ ...base, is_unread_done: true }, now), "Unread done | 7m ago");
  assert.equal(sessionDescription({ ...base, is_done_read: true }, now), "Read done | 7m ago");
});

test("uses distinct row icons for unread and read done sessions", () => {
  assert.equal(sessionIconId({ display_status: "done", is_unread_done: true }), "mail");
  assert.equal(sessionIconId({ display_status: "done", is_done_read: true }), "mail-read");
  assert.equal(sessionIconId({ display_status: "waiting_approval" }), "warning");
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
    { display_status: "waiting_approval", is_attention: true },
    { display_status: "done", is_attention: false },
    { display_status: "done", is_attention: true },
    { display_status: "running", is_attention: false },
  ];

  assert.equal(attentionCount(sessions), 2);
  assert.equal(projectLabel("codex-radar", sessions), "codex-radar - 2 attention / 4");
  assert.equal(projectLabel("idle-project", [{ display_status: "done" }]), "idle-project (1)");
});

test("builds an attention badge from decorated attention state only", () => {
  const sessions = [
    { display_status: "waiting_approval", is_attention: true },
    { display_status: "running", is_attention: false },
    { display_status: "tool_running", is_attention: false },
    { display_status: "done", is_attention: true },
    { display_status: "done", is_attention: false },
  ];

  assert.deepEqual(attentionBadge(sessions), {
    value: 2,
    tooltip: "2 attention sessions",
  });
  assert.equal(attentionBadge([{ display_status: "done", is_attention: false }]), undefined);
  assert.deepEqual(attentionBadge([{ display_status: "done", is_attention: true }]), {
    value: 1,
    tooltip: "1 attention session",
  });
});
