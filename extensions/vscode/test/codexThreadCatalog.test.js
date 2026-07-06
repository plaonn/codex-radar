const assert = require("node:assert/strict");
const test = require("node:test");

const {
  catalogFromThreadLists,
  catalogTitleForSession,
  isArchivedByCodexThreadCatalog,
  loadCodexThreadCatalog,
  parseJsonLines,
  sessionWithCatalogTitle,
  threadArrayFromResult,
  threadListParams,
} = require("../src/codexThreadCatalog");

test("builds a thread catalog from app-server thread/list results", () => {
  const catalog = catalogFromThreadLists({
    active: [
      {
        id: "active-1",
        title: "Active title",
        cwd: "/repo",
        updatedAt: 20,
        status: "notLoaded",
      },
    ],
    archived: [
      {
        id: "archived-1",
        title: "Archived title",
        cwd: "/repo",
        updatedAt: 30,
        status: "notLoaded",
      },
    ],
  });

  assert.equal(catalogTitleForSession({ session_id: "active-1", cwd: "/repo" }, catalog), "Active title");
  assert.equal(catalogTitleForSession({ session_id: "archived-1", cwd: "/repo" }, catalog), "Archived title");
  assert.equal(catalogTitleForSession({ session_id: "active-1", cwd: "/other" }, catalog), "");
  assert.equal(isArchivedByCodexThreadCatalog({ session_id: "archived-1", cwd: "/repo" }, catalog), true);
  assert.equal(isArchivedByCodexThreadCatalog({ session_id: "active-1", cwd: "/repo" }, catalog), false);
});

test("adds catalog title without replacing explicit session title", () => {
  const catalog = catalogFromThreadLists({
    active: [{ id: "session-1", title: "Catalog title", cwd: "/repo" }],
  });

  assert.deepEqual(
    sessionWithCatalogTitle({ session_id: "session-1", cwd: "/repo" }, catalog),
    { session_id: "session-1", cwd: "/repo", thread_title: "Catalog title" },
  );
  assert.deepEqual(
    sessionWithCatalogTitle({ session_id: "session-1", cwd: "/repo", title: "Explicit" }, catalog),
    { session_id: "session-1", cwd: "/repo", title: "Explicit" },
  );
});

test("parses app-server JSON lines and thread result arrays", () => {
  const messages = parseJsonLines([
    JSON.stringify({ id: 2, result: { data: [{ id: "data-1" }] } }),
    "not json",
    JSON.stringify({ id: 3, result: { threads: [{ id: "thread-1" }] } }),
  ].join("\n"));

  assert.equal(messages.length, 2);
  assert.deepEqual(threadArrayFromResult(messages[0].result).map((thread) => thread.id), ["data-1"]);
  assert.deepEqual(threadArrayFromResult(messages[1].result).map((thread) => thread.id), ["thread-1"]);
});

test("loads catalog through injectable app-server runner", async () => {
  const catalog = await loadCodexThreadCatalog({
    cwds: ["/repo", "/repo"],
    runCodexAppServer: async (cwds, options) => {
      assert.deepEqual(cwds, ["/repo"]);
      assert.equal(options.limit, 12);
      return {
        active: [{ id: "active-1", title: "Active title", cwd: "/repo" }],
        archived: [{ id: "archived-1", title: "Archived title", cwd: "/repo" }],
      };
    },
    limit: 12,
  });

  assert.equal(catalogTitleForSession({ session_id: "active-1", cwd: "/repo" }, catalog), "Active title");
  assert.equal(isArchivedByCodexThreadCatalog({ session_id: "archived-1", cwd: "/repo" }, catalog), true);
});

test("does not call app-server without a cwd filter", async () => {
  const catalog = await loadCodexThreadCatalog({
    cwds: [],
    runCodexAppServer: async () => {
      throw new Error("should not be called");
    },
  });

  assert.equal(catalog.entries.size, 0);
  assert.equal(catalog.archivedIds.size, 0);
  assert.equal(catalog.error, "");
});

test("builds thread/list params with cwd filters and lifecycle-neutral status", () => {
  assert.deepEqual(threadListParams(["/repo"], false, { limit: 10 }), {
    archived: false,
    limit: 10,
    sortKey: "updated_at",
    sortDirection: "desc",
    useStateDbOnly: false,
    cwd: "/repo",
  });
  assert.deepEqual(threadListParams(["/a", "/b"], true, { limit: 20 }).cwd, ["/a", "/b"]);
});
