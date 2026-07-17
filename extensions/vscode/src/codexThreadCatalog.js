const { CodexAppServerController, threadListParams } = require("./codexAppServerController");

const DEFAULT_THREAD_LIMIT = 200;
const DEFAULT_TIMEOUT_MS = 2500;

function emptyCodexThreadCatalog(error = "") {
  return {
    entries: new Map(),
    archivedIds: new Set(),
    error: String(error || ""),
  };
}

function threadId(thread) {
  return String(thread?.id || thread?.threadId || thread?.thread_id || "");
}

function threadTitle(thread) {
  return String(thread?.title || thread?.name || thread?.threadTitle || "");
}

function threadCwd(thread) {
  return String(thread?.cwd || thread?.session?.cwd || "");
}

function threadUpdatedAt(thread) {
  const value = thread?.updatedAt ?? thread?.updated_at ?? thread?.updatedAtMs ?? 0;
  return Number(value) || 0;
}

function threadArrayFromResult(result) {
  if (Array.isArray(result)) {
    return result;
  }
  if (Array.isArray(result?.data)) {
    return result.data;
  }
  if (Array.isArray(result?.threads)) {
    return result.threads;
  }
  if (Array.isArray(result?.items)) {
    return result.items;
  }
  return [];
}

function addThread(catalog, thread, archived) {
  const id = threadId(thread);
  if (!id) {
    return;
  }
  const next = {
    id,
    title: threadTitle(thread),
    cwd: threadCwd(thread),
    updatedAt: threadUpdatedAt(thread),
    archived: Boolean(archived),
  };
  const previous = catalog.entries.get(id);
  if (!previous || next.updatedAt >= previous.updatedAt) {
    catalog.entries.set(id, {
      ...previous,
      ...next,
      title: next.title || previous?.title || "",
      cwd: next.cwd || previous?.cwd || "",
      archived: Boolean(previous?.archived || next.archived),
    });
  }
  if (archived) {
    catalog.archivedIds.add(id);
  }
}

function catalogFromThreadLists(lists = {}) {
  const catalog = emptyCodexThreadCatalog();
  for (const thread of lists.active || []) {
    addThread(catalog, thread, false);
  }
  for (const thread of lists.archived || []) {
    addThread(catalog, thread, true);
  }
  return catalog;
}

function parseJsonLines(text) {
  const messages = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      messages.push(JSON.parse(line));
    } catch {
      // Ignore non-protocol noise from experimental app-server versions.
    }
  }
  return messages;
}

async function runCodexAppServer(cwds, options = {}) {
  const controller = new CodexAppServerController({
    codexCommand: options.codexCommand,
    clientVersion: options.clientVersion,
    requestTimeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    spawn: options.spawn,
  });
  try {
    return await controller.listThreads(cwds, {
      limit: options.limit ?? DEFAULT_THREAD_LIMIT,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  } finally {
    controller.dispose();
  }
}

async function loadCodexThreadCatalog(options = {}) {
  const cwds = Array.from(new Set((options.cwds || [])
    .map((cwd) => String(cwd || "").trim())
    .filter(Boolean)))
    .sort();
  if (!cwds.length) {
    return emptyCodexThreadCatalog();
  }
  try {
    const load = options.appServerController
      ? (filteredCwds, loadOptions) => options.appServerController.listThreads(filteredCwds, loadOptions)
      : (options.runCodexAppServer || runCodexAppServer);
    const lists = await load(cwds, {
      ...options,
      limit: options.limit ?? DEFAULT_THREAD_LIMIT,
    });
    return catalogFromThreadLists({
      active: threadArrayFromResult(lists?.active),
      archived: threadArrayFromResult(lists?.archived),
    });
  } catch (error) {
    return emptyCodexThreadCatalog(error instanceof Error ? error.message : String(error));
  }
}

function catalogEntryForSession(session, catalog) {
  const id = String(session?.session_id || session?.sessionId || "");
  if (!id || !(catalog?.entries instanceof Map)) {
    return null;
  }
  const entry = catalog.entries.get(id) || null;
  if (!entry) {
    return null;
  }
  const sessionCwd = String(session?.cwd || "");
  if (sessionCwd && entry.cwd && sessionCwd !== entry.cwd) {
    return null;
  }
  return entry;
}

function catalogTitleForSession(session, catalog) {
  return String(catalogEntryForSession(session, catalog)?.title || "").trim();
}

function isArchivedByCodexThreadCatalog(session, catalog) {
  const id = String(session?.session_id || session?.sessionId || "");
  if (!id || !(catalog?.archivedIds instanceof Set) || !catalog.archivedIds.has(id)) {
    return false;
  }
  const entry = catalogEntryForSession(session, catalog);
  return Boolean(entry && entry.archived);
}

function sessionWithCatalogTitle(session, catalog) {
  const title = catalogTitleForSession(session, catalog);
  if (!title || session?.title || session?.thread_title || session?.conversation_title) {
    return session;
  }
  return {
    ...session,
    thread_title: title,
  };
}

module.exports = {
  catalogFromThreadLists,
  catalogTitleForSession,
  emptyCodexThreadCatalog,
  isArchivedByCodexThreadCatalog,
  loadCodexThreadCatalog,
  parseJsonLines,
  runCodexAppServer,
  sessionWithCatalogTitle,
  threadArrayFromResult,
  threadListParams,
};
