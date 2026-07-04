const assert = require("node:assert/strict");
const test = require("node:test");

const {
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
    base: "/tmp/codex-radar",
    pattern: "sessions.json",
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
