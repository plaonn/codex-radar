const path = require("node:path");
const vscode = require("vscode");

const { officialCodexThreadUriString } = require("./codexLink");
const {
  defaultStateDir,
  filterSessionsByStatus,
  groupSessionsByProject,
  loadSessionCache,
  normalizeStatusFilter,
  STATUS_FILTER_VALUES,
} = require("./sessionSource");
const {
  attentionBadge,
  projectLabel,
  sessionDescription,
  sessionIconId,
  sessionLabel,
  sessionTooltip,
} = require("./sessionViewModel");
const {
  registerRefreshHandlers,
  sessionCacheWatchTarget,
} = require("./sessionWatcher");
const {
  HIDDEN_SESSION_KEYS_KEY,
  READ_DONE_KEYS_KEY,
  decorateSessions,
  isDoneSession,
  markSessionHidden,
  markDoneRead,
  markDoneUnread,
  readStateFromValue,
  readStateToValue,
  restoreSession,
} = require("./readState");

class ProjectItem extends vscode.TreeItem {
  constructor(project, sessions) {
    super(projectLabel(project, sessions), vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "codexRadar.project";
    this.iconPath = new vscode.ThemeIcon("folder");
    this.project = project;
  }
}

class SessionItem extends vscode.TreeItem {
  constructor(session, options = {}) {
    super(sessionLabel(session), vscode.TreeItemCollapsibleState.None);
    this.contextValue = sessionContextValue(session);
    this.session = session;
    this.description = sessionDescription(session, options);
    this.tooltip = sessionTooltip(session);
    this.iconPath = sessionIcon(session);
    this.command = {
      command: "codexRadar.openInCodex",
      title: "Open in Codex",
      arguments: [this],
    };
  }
}

function sessionIcon(session) {
  return new vscode.ThemeIcon(sessionIconId(session));
}

function sessionContextValue(session) {
  if (session.is_hidden) {
    return "codexRadar.session.hidden";
  }
  if (isDoneSession(session)) {
    return session.is_unread_done ? "codexRadar.session.done.unread" : "codexRadar.session.done.read";
  }
  return "codexRadar.session";
}

class SessionsProvider {
  constructor(globalState, viewMode = "projects") {
    this.globalState = globalState;
    this.viewMode = viewMode;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.lastError = "";
    this.statusFilter = "";
    this.sessions = [];
    this.items = [];
    this.attentionSessions = [];
    this.groups = [];
    this.refresh();
  }

  refresh() {
    try {
      const stateDir = configuredStateDir();
      const readKeys = this.readKeys();
      const hiddenKeys = this.hiddenKeys();
      const decorated = decorateSessions(loadSessionCache(stateDir), readKeys, hiddenKeys);
      const activeSessions = decorated.filter((session) => !session.is_hidden);
      this.sessions = activeSessions;
      this.items = [];
      this.attentionSessions = activeSessions.filter((session) => session.is_attention);
      this.groups = [];
      if (this.viewMode === "attention") {
        this.items = this.attentionSessions;
      } else if (this.viewMode === "hidden") {
        this.items = decorated.filter((session) => session.is_hidden);
      } else {
        const visibleSessions = filterSessionsByStatus(activeSessions, this.statusFilter);
        this.groups = groupSessionsByProject(visibleSessions);
      }
      this.lastError = "";
    } catch (error) {
      this.sessions = [];
      this.items = [];
      this.attentionSessions = [];
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

    if (this.viewMode === "attention" || this.viewMode === "hidden") {
      if (this.items.length === 0) {
        const item = new vscode.TreeItem(
          this.viewMode === "attention" ? "No attention sessions" : "No hidden sessions",
        );
        item.iconPath = new vscode.ThemeIcon("info");
        return Promise.resolve([item]);
      }
      return Promise.resolve(
        this.items.map((session) => new SessionItem(session, { showProject: true })),
      );
    }

    if (this.groups.length === 0) {
      const label = this.statusFilter
        ? `No sessions match ${this.statusFilter}`
        : "No sessions indexed";
      const item = new vscode.TreeItem(label);
      item.description = this.statusFilter ? "Clear the filter to show all sessions." : "";
      item.iconPath = new vscode.ThemeIcon("info");
      return Promise.resolve([item]);
    }

    return Promise.resolve(
      this.groups.map((group) => {
        return new ProjectItem(group.project, group.sessions);
      }),
    );
  }

  setStatusFilter(statusFilter) {
    this.statusFilter = normalizeStatusFilter(statusFilter);
    this.refresh();
  }

  attentionBadge() {
    return attentionBadge(this.sessions);
  }

  readKeys() {
    return readStateFromValue(this.globalState.get(READ_DONE_KEYS_KEY, []));
  }

  hiddenKeys() {
    return readStateFromValue(this.globalState.get(HIDDEN_SESSION_KEYS_KEY, []));
  }

  async updateReadKeys(readKeys) {
    await this.globalState.update(READ_DONE_KEYS_KEY, readStateToValue(readKeys));
    this.refresh();
  }

  async updateHiddenKeys(hiddenKeys) {
    await this.globalState.update(HIDDEN_SESSION_KEYS_KEY, readStateToValue(hiddenKeys));
    this.refresh();
  }

  async markSessionRead(session) {
    await this.updateReadKeys(markDoneRead(this.readKeys(), session));
  }

  async markSessionUnread(session) {
    await this.updateReadKeys(markDoneUnread(this.readKeys(), session));
  }

  async hideSession(session) {
    await this.updateHiddenKeys(markSessionHidden(this.hiddenKeys(), session));
  }

  async restoreSession(session) {
    await this.updateHiddenKeys(restoreSession(this.hiddenKeys(), session));
  }
}

function refreshProviders(providers) {
  for (const provider of providers) {
    provider.refresh();
  }
}

function syncTreeViewBadge(attentionTreeView, provider) {
  attentionTreeView.badge = provider.attentionBadge();
}

function configuredStateDir() {
  const configured = vscode.workspace.getConfiguration("codexRadar").get("stateDir", "");
  if (typeof configured === "string" && configured.trim()) {
    return path.resolve(configured.replace(/^~(?=$|[\\/])/, process.env.HOME || "~"));
  }
  return defaultStateDir();
}

function createSessionCacheWatcher(provider, afterRefresh = () => {}) {
  const target = sessionCacheWatchTarget(configuredStateDir());
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(target.base, target.pattern),
  );
  const refreshHandlers = registerRefreshHandlers(watcher, () => {
    provider.refresh();
    afterRefresh();
  });

  return {
    dispose() {
      refreshHandlers.dispose();
      watcher.dispose();
    },
  };
}

class SessionCacheWatcherManager {
  constructor(provider, afterRefresh = () => {}) {
    this.provider = provider;
    this.afterRefresh = afterRefresh;
    this.current = null;
    this.reset();
  }

  reset() {
    this.disposeCurrent();
    this.current = createSessionCacheWatcher(this.provider, this.afterRefresh);
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

function statusFilterItems(currentStatusFilter = "") {
  const current = normalizeStatusFilter(currentStatusFilter) || "all";
  return STATUS_FILTER_VALUES.map((status) => {
    const value = normalizeStatusFilter(status);
    return {
      label: status === "all" ? "All statuses" : status === "attention" ? "Attention" : status,
      description: status === current ? "current" : "",
      value,
    };
  });
}

async function chooseStatusFilter(provider) {
  const selected = await vscode.window.showQuickPick(statusFilterItems(provider.statusFilter), {
    placeHolder: "Filter Codex Radar sessions by status",
  });
  if (selected) {
    provider.setStatusFilter(selected.value);
  }
}

function sessionFromTarget(target) {
  const session = target && target.session ? target.session : target;
  if (!session || typeof session !== "object") {
    return null;
  }
  return session;
}

function officialCodexThreadUri(session) {
  const uri = officialCodexThreadUriString(session);
  if (!uri) {
    return null;
  }
  return vscode.Uri.parse(uri);
}

async function openOfficialCodexThread(target) {
  const session = sessionFromTarget(target);
  if (!session) {
    await vscode.window.showWarningMessage("Select a Codex Radar session to open in Codex.");
    return false;
  }

  const uri = officialCodexThreadUri(session);
  if (!uri) {
    await vscode.window.showWarningMessage("Codex session id is not available for this session.");
    return false;
  }

  const opened = await vscode.env.openExternal(uri);
  if (!opened) {
    await vscode.window.showWarningMessage("Could not open this session in the Codex extension.");
  }
  return opened;
}

async function openSessionInCodex(target, providers, attentionTreeView) {
  const session = sessionFromTarget(target);
  const opened = await openOfficialCodexThread(session);
  if (opened && session && isDoneSession(session)) {
    await providers[0].markSessionRead(session);
    refreshProviders(providers);
    syncTreeViewBadge(attentionTreeView, providers[0]);
  }
  return opened;
}

async function markSessionReadCommand(target, providers, attentionTreeView) {
  const session = sessionFromTarget(target);
  if (!session || !isDoneSession(session)) {
    await vscode.window.showWarningMessage("Select a done Codex Radar session to mark read.");
    return;
  }
  await providers[0].markSessionRead(session);
  refreshProviders(providers);
  syncTreeViewBadge(attentionTreeView, providers[0]);
}

async function markSessionUnreadCommand(target, providers, attentionTreeView) {
  const session = sessionFromTarget(target);
  if (!session || !isDoneSession(session)) {
    await vscode.window.showWarningMessage("Select a done Codex Radar session to mark unread.");
    return;
  }
  await providers[0].markSessionUnread(session);
  refreshProviders(providers);
  syncTreeViewBadge(attentionTreeView, providers[0]);
}

async function hideSessionCommand(target, providers, attentionTreeView) {
  const session = sessionFromTarget(target);
  if (!session) {
    await vscode.window.showWarningMessage("Select a Codex Radar session to hide.");
    return;
  }
  await providers[0].hideSession(session);
  refreshProviders(providers);
  syncTreeViewBadge(attentionTreeView, providers[0]);
}

async function restoreSessionCommand(target, providers, attentionTreeView) {
  const session = sessionFromTarget(target);
  if (!session) {
    await vscode.window.showWarningMessage("Select a hidden Codex Radar session to restore.");
    return;
  }
  await providers[0].restoreSession(session);
  refreshProviders(providers);
  syncTreeViewBadge(attentionTreeView, providers[0]);
}

function activate(context) {
  const attentionProvider = new SessionsProvider(context.globalState, "attention");
  const projectsProvider = new SessionsProvider(context.globalState, "projects");
  const hiddenProvider = new SessionsProvider(context.globalState, "hidden");
  const providers = [attentionProvider, projectsProvider, hiddenProvider];
  const attentionTreeView = vscode.window.createTreeView("codexRadar.attentionList", {
    treeDataProvider: attentionProvider,
  });
  const projectsTreeView = vscode.window.createTreeView("codexRadar.projectList", {
    treeDataProvider: projectsProvider,
  });
  const hiddenTreeView = vscode.window.createTreeView("codexRadar.hiddenList", {
    treeDataProvider: hiddenProvider,
  });
  syncTreeViewBadge(attentionTreeView, attentionProvider);
  const watcherManager = new SessionCacheWatcherManager(attentionProvider, () => {
    refreshProviders(providers);
    syncTreeViewBadge(attentionTreeView, attentionProvider);
  });
  context.subscriptions.push(
    attentionTreeView,
    projectsTreeView,
    hiddenTreeView,
    vscode.commands.registerCommand("codexRadar.refresh", () => {
      refreshProviders(providers);
      syncTreeViewBadge(attentionTreeView, attentionProvider);
    }),
    vscode.commands.registerCommand("codexRadar.filterStatus", async () => {
      await chooseStatusFilter(projectsProvider);
      syncTreeViewBadge(attentionTreeView, attentionProvider);
    }),
    vscode.commands.registerCommand("codexRadar.markRead", (target) =>
      markSessionReadCommand(target, providers, attentionTreeView),
    ),
    vscode.commands.registerCommand("codexRadar.markUnread", (target) =>
      markSessionUnreadCommand(target, providers, attentionTreeView),
    ),
    vscode.commands.registerCommand("codexRadar.hideSession", (target) =>
      hideSessionCommand(target, providers, attentionTreeView),
    ),
    vscode.commands.registerCommand("codexRadar.restoreSession", (target) =>
      restoreSessionCommand(target, providers, attentionTreeView),
    ),
    vscode.commands.registerCommand("codexRadar.openInCodex", (target) =>
      openSessionInCodex(target, providers, attentionTreeView),
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      const stateDirChanged = event.affectsConfiguration("codexRadar.stateDir");
      if (stateDirChanged) {
        watcherManager.reset();
        refreshProviders(providers);
        syncTreeViewBadge(attentionTreeView, attentionProvider);
      }
    }),
    watcherManager,
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  officialCodexThreadUri,
  openOfficialCodexThread,
  openSessionInCodex,
  hideSessionCommand,
  refreshProviders,
  restoreSessionCommand,
  syncTreeViewBadge,
  statusFilterItems,
};
