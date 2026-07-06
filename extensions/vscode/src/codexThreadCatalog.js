const childProcess = require("node:child_process");

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

function threadListParams(cwds, archived, options = {}) {
  const params = {
    archived,
    limit: options.limit ?? DEFAULT_THREAD_LIMIT,
    sortKey: "updated_at",
    sortDirection: "desc",
    useStateDbOnly: false,
  };
  if (cwds.length === 1) {
    params.cwd = cwds[0];
  } else if (cwds.length > 1) {
    params.cwd = cwds;
  }
  return params;
}

function initializeRequest() {
  return {
    id: 1,
    method: "initialize",
    params: {
      clientInfo: {
        name: "codex_radar_vscode",
        title: "Codex Radar VS Code",
        version: "0.0.0",
      },
      capabilities: { experimentalApi: true },
    },
  };
}

function threadListRequest(id, cwds, archived, options = {}) {
  return {
    id,
    method: "thread/list",
    params: threadListParams(cwds, archived, options),
  };
}

function send(proc, message) {
  proc.stdin.write(`${JSON.stringify(message)}\n`);
}

function runCodexAppServer(cwds, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = childProcess.spawn(options.codexCommand || "codex", ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "";
    let stderr = "";
    let active = null;
    let archived = null;
    let settled = false;

    function settle(error, value) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        proc.stdin.end();
      } catch {
        // Process may already be gone.
      }
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGTERM");
        }
      }, 50);
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    }

    const timer = setTimeout(() => {
      settle(new Error(stderr.trim() || "codex app-server thread/list timed out"));
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    proc.on("error", (error) => settle(error));
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) {
          break;
        }
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) {
          continue;
        }
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1) {
          if (message.error) {
            settle(new Error(JSON.stringify(message.error)));
            return;
          }
          send(proc, { method: "initialized", params: {} });
          send(proc, threadListRequest(2, cwds, false, options));
          send(proc, threadListRequest(3, cwds, true, options));
          continue;
        }
        if (message.id === 2) {
          if (message.error) {
            settle(new Error(JSON.stringify(message.error)));
            return;
          }
          active = threadArrayFromResult(message.result);
        }
        if (message.id === 3) {
          if (message.error) {
            settle(new Error(JSON.stringify(message.error)));
            return;
          }
          archived = threadArrayFromResult(message.result);
        }
        if (active && archived) {
          settle(null, { active, archived });
          return;
        }
      }
    });

    send(proc, initializeRequest());
  });
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
    return catalogFromThreadLists(await (options.runCodexAppServer || runCodexAppServer)(cwds, options));
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
  catalogEntryForSession,
  emptyCodexThreadCatalog,
  isArchivedByCodexThreadCatalog,
  loadCodexThreadCatalog,
  parseJsonLines,
  runCodexAppServer,
  sessionWithCatalogTitle,
  threadArrayFromResult,
  threadListParams,
};
