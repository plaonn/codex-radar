const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  PENDING_WORKSPACE_HANDOFF_KEY,
  createPendingWorkspaceHandoff,
  isPendingWorkspaceHandoffFresh,
  normalizeOpenThreadBehavior,
  pendingWorkspaceHandoffCanResume,
  pendingWorkspaceHandoffMatches,
  resolveWorkspaceHandoffAction,
  sessionWorkspaceContext,
} = require("../src/workspaceHandoff");

test("normalizes unsupported open behavior to ask", () => {
  assert.equal(normalizeOpenThreadBehavior("openWorkspace"), "openWorkspace");
  assert.equal(normalizeOpenThreadBehavior("openHere"), "openHere");
  assert.equal(normalizeOpenThreadBehavior("unexpected"), "ask");
  assert.equal(PENDING_WORKSPACE_HANDOFF_KEY, "codexRadar.pendingWorkspaceHandoff.v1");
});

test("recognizes session cwd inside the current workspace", () => {
  assert.deepEqual(
    sessionWorkspaceContext(
      { cwd: path.join("/work", "project", "packages", "app") },
      [path.join("/work", "project")],
    ),
    {
      kind: "current",
      cwd: path.resolve("/work/project/packages/app"),
    },
  );
  assert.equal(sessionWorkspaceContext({ cwd: "/work/other" }, ["/work/project"]).kind, "other");
  assert.equal(sessionWorkspaceContext({}, ["/work/project"]).kind, "unknown");
});

test("opens matching or unknown workspace sessions here without prompting", async () => {
  let prompted = false;
  const current = await resolveWorkspaceHandoffAction(
    { cwd: "/work/project" },
    {
      workspaceFolders: ["/work/project"],
      behavior: "ask",
      choose: async () => {
        prompted = true;
        return "openWorkspace";
      },
    },
  );
  const unknown = await resolveWorkspaceHandoffAction({}, { behavior: "openWorkspace" });

  assert.equal(current.action, "openHere");
  assert.equal(unknown.action, "openHere");
  assert.equal(prompted, false);
});

test("honors persisted behavior only for workspace mismatches", async () => {
  const session = { cwd: "/work/other" };

  assert.equal(
    (await resolveWorkspaceHandoffAction(session, {
      workspaceFolders: ["/work/current"],
      behavior: "openWorkspace",
    })).action,
    "openWorkspace",
  );
  assert.equal(
    (await resolveWorkspaceHandoffAction(session, {
      workspaceFolders: ["/work/current"],
      behavior: "openHere",
    })).action,
    "openHere",
  );
});

test("uses the ask callback for workspace mismatches and supports cancellation", async () => {
  const selected = await resolveWorkspaceHandoffAction(
    { cwd: "/work/other" },
    {
      workspaceFolders: ["/work/current"],
      behavior: "ask",
      choose: async ({ cwd }) => cwd === path.resolve("/work/other") ? "openWorkspace" : "cancel",
    },
  );
  const cancelled = await resolveWorkspaceHandoffAction(
    { cwd: "/work/other" },
    {
      workspaceFolders: ["/work/current"],
      behavior: "ask",
      choose: async () => undefined,
    },
  );

  assert.equal(selected.action, "openWorkspace");
  assert.equal(cancelled.action, "cancel");
});

test("creates bounded pending handoffs that match only the destination workspace", () => {
  const pending = createPendingWorkspaceHandoff(
    {
      session_id: "session-1",
      cwd: "/work/project/packages/app",
      display_status: "done",
      last_seen_at: "2026-07-10T12:00:00+09:00",
    },
    { requestId: "request-1", now: 1_000 },
  );

  assert.deepEqual(pending, {
    requestId: "request-1",
    sessionId: "session-1",
    cwd: path.resolve("/work/project/packages/app"),
    requestedAt: 1_000,
    displayStatus: "done",
    lastSeenAt: "2026-07-10T12:00:00+09:00",
  });
  assert.equal(isPendingWorkspaceHandoffFresh(pending, { now: 2_000, maxAgeMs: 2_000 }), true);
  assert.equal(isPendingWorkspaceHandoffFresh(pending, { now: 4_000, maxAgeMs: 2_000 }), false);
  assert.equal(pendingWorkspaceHandoffMatches(pending, ["/work/project"]), true);
  assert.equal(pendingWorkspaceHandoffMatches(pending, ["/work/other"]), false);
});

test("resumes a pending handoff only in the focused destination workspace", () => {
  const pending = createPendingWorkspaceHandoff(
    { session_id: "session-1", cwd: "/work/project" },
    { requestId: "request-1", now: 1_000 },
  );

  assert.equal(pendingWorkspaceHandoffCanResume(
    pending,
    ["/work/project"],
    { windowFocused: false, now: 2_000 },
  ), false);
  assert.equal(pendingWorkspaceHandoffCanResume(
    pending,
    ["/work/other"],
    { windowFocused: true, now: 2_000 },
  ), false);
  assert.equal(pendingWorkspaceHandoffCanResume(
    pending,
    ["/work/project"],
    { windowFocused: true, now: 2_000 },
  ), true);
});
