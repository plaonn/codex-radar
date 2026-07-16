const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  WatcherSetManager,
  archivedTranscriptWatchTarget,
  registerArchiveRefreshHandlers,
  registerRefreshHandlers,
  sessionCacheWatchTarget,
} = require("../src/sessionWatcher");

function fakeWatcher() {
  const handlers = {
    create: [],
    change: [],
    delete: [],
  };
  const disposables = [];

  function register(kind, callback) {
    handlers[kind].push(callback);
    const disposable = {
      disposed: false,
      dispose() {
        this.disposed = true;
      },
    };
    disposables.push(disposable);
    return disposable;
  }

  return {
    disposables,
    emit(kind) {
      for (const callback of handlers[kind]) {
        callback();
      }
    },
    onDidCreate(callback) {
      return register("create", callback);
    },
    onDidChange(callback) {
      return register("change", callback);
    },
    onDidDelete(callback) {
      return register("delete", callback);
    },
  };
}

test("builds a sessions.json watch target inside the state directory", () => {
  assert.deepEqual(sessionCacheWatchTarget("/tmp/codex-radar"), {
    base: path.resolve("/tmp/codex-radar"),
    pattern: "sessions.json",
  });
});

test("builds an archived transcript watch target inside CODEX_HOME", () => {
  assert.deepEqual(archivedTranscriptWatchTarget("/tmp/codex-home"), {
    base: path.resolve("/tmp/codex-home"),
    pattern: "archived_sessions/**/*.jsonl",
  });
});

test("refreshes on session cache create, change, and delete events", () => {
  const watcher = fakeWatcher();
  let refreshCount = 0;
  const disposable = registerRefreshHandlers(watcher, () => {
    refreshCount += 1;
  });

  watcher.emit("create");
  watcher.emit("change");
  watcher.emit("delete");

  assert.equal(refreshCount, 3);

  disposable.dispose();
  assert.equal(watcher.disposables.every((item) => item.disposed), true);
});

test("refreshes on archive and unarchive without observing transcript changes", () => {
  const watcher = fakeWatcher();
  let refreshCount = 0;
  const disposable = registerArchiveRefreshHandlers(watcher, () => {
    refreshCount += 1;
  });

  watcher.emit("create");
  watcher.emit("change");
  watcher.emit("delete");

  assert.equal(refreshCount, 2);
  assert.equal(watcher.disposables.length, 2);

  disposable.dispose();
  assert.equal(watcher.disposables.every((item) => item.disposed), true);
});

test("disposes every watcher when resetting and shutting down", () => {
  const generations = [];
  const manager = new WatcherSetManager(() => {
    const generation = [
      { disposed: false, dispose() { this.disposed = true; } },
      { disposed: false, dispose() { this.disposed = true; } },
    ];
    generations.push(generation);
    return generation;
  });

  manager.reset();
  assert.equal(generations.length, 2);
  assert.equal(generations[0].every((watcher) => watcher.disposed), true);
  assert.equal(generations[1].every((watcher) => watcher.disposed), false);

  manager.dispose();
  assert.equal(generations[1].every((watcher) => watcher.disposed), true);
});
