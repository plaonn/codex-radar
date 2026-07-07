const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function codexHome(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  return path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(homeDir, ".codex"));
}

function stateDbCandidates(options = {}) {
  const home = codexHome(options);
  return [
    options.codexStateDb,
    path.join(home, "state_5.sqlite"),
    path.join(home, "sqlite", "state_5.sqlite"),
  ].filter(Boolean);
}

function readArchivedThreadRows(options = {}) {
  const dbPath = stateDbCandidates(options).find((candidate) => fs.existsSync(candidate));
  if (!dbPath) {
    return [];
  }

  let output = "";
  try {
    output = childProcess.execFileSync(
      "sqlite3",
      [
        "-readonly",
        "-separator",
        "\t",
        dbPath,
        "select id, cwd, created_at, updated_at from threads where archived = 1;",
      ],
      { encoding: "utf8", timeout: options.sqliteTimeoutMs ?? 1000 },
    );
  } catch {
    return [];
  }

  return output.split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [id, cwd, createdAt, updatedAt] = line.split("\t");
      return {
        id: String(id || ""),
        cwd: String(cwd || ""),
        createdAt: Number.parseInt(createdAt, 10) || 0,
        updatedAt: Number.parseInt(updatedAt, 10) || 0,
      };
    })
    .filter((row) => row.id);
}

function archivedThreadState(options = {}) {
  if (typeof options.resolveCodexArchivedThreads === "function") {
    return options.resolveCodexArchivedThreads(options);
  }
  const cache = options.codexThreadStateCache instanceof Map ? options.codexThreadStateCache : null;
  const cacheKey = `archivedThreads:${codexHome(options)}`;
  if (cache && cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  const rows = readArchivedThreadRows(options);
  const state = {
    ids: new Set(rows.map((row) => row.id)),
    rows,
  };
  if (cache) {
    cache.set(cacheKey, state);
  }
  return state;
}

function isArchivedByCodexThreadState(session, options = {}) {
  const state = archivedThreadState(options);
  const sessionId = String(session?.session_id || "");
  return Boolean(sessionId && state.ids.has(sessionId));
}

module.exports = {
  archivedThreadState,
  isArchivedByCodexThreadState,
  readArchivedThreadRows,
  stateDbCandidates,
};
