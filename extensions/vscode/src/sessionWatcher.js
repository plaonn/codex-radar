const path = require("node:path");

function sessionCacheWatchTarget(stateDir) {
  return {
    base: path.resolve(stateDir),
    pattern: "sessions.json",
  };
}

function registerRefreshHandlers(watcher, refresh) {
  const disposables = [
    watcher.onDidCreate(refresh),
    watcher.onDidChange(refresh),
    watcher.onDidDelete(refresh),
  ];

  return {
    dispose() {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    },
  };
}

module.exports = {
  registerRefreshHandlers,
  sessionCacheWatchTarget,
};
