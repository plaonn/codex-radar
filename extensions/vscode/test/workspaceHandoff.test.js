const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  normalizeOpenThreadBehavior,
  resolveWorkspaceHandoffAction,
  sessionWorkspaceContext,
} = require("../src/workspaceHandoff");

test("normalizes unsupported open behavior to ask", () => {
  assert.equal(normalizeOpenThreadBehavior("openWorkspace"), "openWorkspace");
  assert.equal(normalizeOpenThreadBehavior("openHere"), "openHere");
  assert.equal(normalizeOpenThreadBehavior("unexpected"), "ask");
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
