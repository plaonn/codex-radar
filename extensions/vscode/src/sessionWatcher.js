const path = require("node:path");

function sessionCacheWatchTarget(stateDir) {
  return {
    base: path.resolve(stateDir),
    pattern: "sessions.json",
  };
}

function archivedTranscriptWatchTarget(codexHome) {
  return {
    base: path.resolve(codexHome),
    pattern: "archived_sessions/**/*.jsonl",
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

function registerArchiveRefreshHandlers(watcher, refresh) {
  const disposables = [
    watcher.onDidCreate(refresh),
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

class WatcherSetManager {
  constructor(createWatchers) {
    this.createWatchers = createWatchers;
    this.current = null;
    this.reset();
  }

  reset() {
    this.disposeCurrent();
    this.current = this.createWatchers();
  }

  disposeCurrent() {
    if (this.current) {
      for (const watcher of this.current) {
        watcher.dispose();
      }
      this.current = null;
    }
  }

  dispose() {
    this.disposeCurrent();
  }
}

module.exports = {
  WatcherSetManager,
  archivedTranscriptWatchTarget,
  registerArchiveRefreshHandlers,
  registerRefreshHandlers,
  sessionCacheWatchTarget,
};
