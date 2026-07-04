const path = require("node:path");
const vscode = require("vscode");

const {
  defaultStateDir,
  filterSessionsByStatus,
  groupSessionsByProject,
  loadSessionCache,
  normalizeStatusFilter,
} = require("./sessionSource");
const {
  projectLabel,
  sessionDescription,
  sessionLabel,
} = require("./sessionViewModel");
const {
  registerRefreshHandlers,
  sessionCacheWatchTarget,
} = require("./sessionWatcher");

class ProjectItem extends vscode.TreeItem {
  constructor(project, sessions) {
    super(projectLabel(project, sessions), vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "codexRadar.project";
    this.iconPath = new vscode.ThemeIcon("folder");
    this.project = project;
  }
}

class SessionItem extends vscode.TreeItem {
  constructor(session) {
    super(sessionLabel(session), vscode.TreeItemCollapsibleState.None);
    this.contextValue = "codexRadar.session";
    this.description = sessionDescription(session);
    this.tooltip = [
      `Project: ${session.project || "-"}`,
      `Status: ${session.display_status || "-"}`,
      `Last event: ${session.last_event_name || "-"}`,
      `Last seen: ${session.last_seen_at || "-"}`,
      `Model: ${session.model || "-"}`,
    ].join("\n");
    this.iconPath = statusIcon(session.display_status);
  }
}

function statusIcon(status) {
  if (status === "waiting_approval") {
    return new vscode.ThemeIcon("warning");
  }
  if (status === "running" || status === "tool_running") {
    return new vscode.ThemeIcon("sync~spin");
  }
  if (status === "stale") {
    return new vscode.ThemeIcon("watch");
  }
  if (status === "done") {
    return new vscode.ThemeIcon("check");
  }
  return new vscode.ThemeIcon("circle-outline");
}

class SessionsProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.lastError = "";
    this.statusFilter = "";
    this.groups = [];
    this.refresh();
  }

  refresh() {
    try {
      const stateDir = configuredStateDir();
      this.statusFilter = configuredStatusFilter();
      const sessions = filterSessionsByStatus(loadSessionCache(stateDir), this.statusFilter);
      this.groups = groupSessionsByProject(sessions);
      this.lastError = "";
    } catch (error) {
      this.groups = [];
      this.lastError = error instanceof Error ? error.message : String(error);
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (element instanceof ProjectItem) {
      const group = this.groups.find((item) => item.project === element.project);
      return Promise.resolve((group?.sessions || []).map((session) => new SessionItem(session)));
    }

    if (this.lastError) {
      const item = new vscode.TreeItem("Could not read codex-radar sessions");
      item.description = this.lastError;
      item.iconPath = new vscode.ThemeIcon("error");
      return Promise.resolve([item]);
    }

    if (this.groups.length === 0) {
      const label = this.statusFilter
        ? `No sessions match status: ${this.statusFilter}`
        : "No sessions indexed yet";
      const item = new vscode.TreeItem(label);
      item.iconPath = new vscode.ThemeIcon("info");
      return Promise.resolve([item]);
    }

    return Promise.resolve(
      this.groups.map((group) => {
        return new ProjectItem(group.project, group.sessions);
      }),
    );
  }
}

function configuredStateDir() {
  const configured = vscode.workspace.getConfiguration("codexRadar").get("stateDir", "");
  if (typeof configured === "string" && configured.trim()) {
    return path.resolve(configured.replace(/^~(?=$|[\\/])/, process.env.HOME || "~"));
  }
  return defaultStateDir();
}

function configuredStatusFilter() {
  const configured = vscode.workspace.getConfiguration("codexRadar").get("statusFilter", "all");
  return normalizeStatusFilter(configured);
}

function createSessionCacheWatcher(provider) {
  const target = sessionCacheWatchTarget(configuredStateDir());
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(target.base, target.pattern),
  );
  const refreshHandlers = registerRefreshHandlers(watcher, () => provider.refresh());

  return {
    dispose() {
      refreshHandlers.dispose();
      watcher.dispose();
    },
  };
}

class SessionCacheWatcherManager {
  constructor(provider) {
    this.provider = provider;
    this.current = null;
    this.reset();
  }

  reset() {
    this.disposeCurrent();
    this.current = createSessionCacheWatcher(this.provider);
  }

  disposeCurrent() {
    if (this.current) {
      this.current.dispose();
      this.current = null;
    }
  }

  dispose() {
    this.disposeCurrent();
  }
}

function activate(context) {
  const provider = new SessionsProvider();
  const watcherManager = new SessionCacheWatcherManager(provider);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("codexRadar.sessions", provider),
    vscode.commands.registerCommand("codexRadar.refresh", () => provider.refresh()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      const stateDirChanged = event.affectsConfiguration("codexRadar.stateDir");
      const statusFilterChanged = event.affectsConfiguration("codexRadar.statusFilter");
      if (stateDirChanged) {
        watcherManager.reset();
      }
      if (stateDirChanged || statusFilterChanged) {
        provider.refresh();
      }
    }),
    watcherManager,
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
