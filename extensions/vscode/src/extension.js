const path = require("node:path");
const vscode = require("vscode");

const { officialCodexThreadUriString } = require("./codexLink");
const {
  STATUS_FILTER_VALUES,
  defaultStateDir,
  filterSessionsByStatus,
  groupSessionsByProject,
  loadSessionCache,
  normalizeStatusFilter,
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
const { buildDashboardModel, findSessionByKey } = require("./dashboardViewModel");

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
    this.iconPath = new vscode.ThemeIcon(sessionIconId(session));
    this.command = {
      command: "codexRadar.openInCodex",
      title: "Open in Codex",
      arguments: [this],
    };
  }
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

function configuredStateDir() {
  const configured = vscode.workspace.getConfiguration("codexRadar").get("stateDir", "");
  if (typeof configured === "string" && configured.trim()) {
    return path.resolve(configured.replace(/^~(?=$|[\\/])/, process.env.HOME || "~"));
  }
  return defaultStateDir();
}

function readKeys(globalState) {
  return readStateFromValue(globalState.get(READ_DONE_KEYS_KEY, []));
}

function hiddenKeys(globalState) {
  return readStateFromValue(globalState.get(HIDDEN_SESSION_KEYS_KEY, []));
}

async function updateReadKeys(globalState, keys) {
  await globalState.update(READ_DONE_KEYS_KEY, readStateToValue(keys));
}

async function updateHiddenKeys(globalState, keys) {
  await globalState.update(HIDDEN_SESSION_KEYS_KEY, readStateToValue(keys));
}

function loadDecoratedSessions(globalState, stateDir = configuredStateDir()) {
  return decorateSessions(loadSessionCache(stateDir), readKeys(globalState), hiddenKeys(globalState));
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
      const decorated = loadDecoratedSessions(this.globalState);
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

    return Promise.resolve(this.groups.map((group) => new ProjectItem(group.project, group.sessions)));
  }

  setStatusFilter(statusFilter) {
    this.statusFilter = normalizeStatusFilter(statusFilter);
    this.refresh();
  }

  attentionBadge() {
    return attentionBadge(this.sessions);
  }

  async markSessionRead(session) {
    await updateReadKeys(this.globalState, markDoneRead(readKeys(this.globalState), session));
    this.refresh();
  }

  async markSessionUnread(session) {
    await updateReadKeys(this.globalState, markDoneUnread(readKeys(this.globalState), session));
    this.refresh();
  }

  async hideSession(session) {
    await updateHiddenKeys(this.globalState, markSessionHidden(hiddenKeys(this.globalState), session));
    this.refresh();
  }

  async restoreSession(session) {
    await updateHiddenKeys(this.globalState, restoreSession(hiddenKeys(this.globalState), session));
    this.refresh();
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

function webviewNonce() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

function dashboardHtml(webview, extensionUri) {
  const nonce = webviewNonce();
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "dashboard.css"));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "dashboard.js"));
  const cspSource = webview.cspSource;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src ${cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
  <title>Codex Radar</title>
</head>
<body>
  <main id="app" aria-live="polite"></main>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

class DashboardPanelController {
  constructor(context, onDidMutate = () => {}) {
    this.context = context;
    this.onDidMutate = onDidMutate;
    this.statusFilter = "";
    this.selectedKey = "";
    this.sessions = [];
    this.model = null;
    this.lastError = "";
    this.panel = null;
    this.refresh();
  }

  refresh() {
    try {
      this.sessions = loadDecoratedSessions(this.context.globalState);
      this.model = buildDashboardModel(this.sessions, {
        homeDir: process.env.HOME || "",
        selectedKey: this.selectedKey,
        statusFilter: this.statusFilter,
      });
      this.selectedKey = this.model.selected?.key || "";
      this.lastError = "";
    } catch (error) {
      this.sessions = [];
      this.model = buildDashboardModel([], {
        selectedKey: this.selectedKey,
        statusFilter: this.statusFilter,
      });
      this.lastError = error instanceof Error ? error.message : String(error);
    }
    this.postState();
  }

  open() {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      this.postState();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "codexRadar.dashboard",
      "Codex Radar Dashboard",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
      },
    );
    this.panel.webview.html = dashboardHtml(this.panel.webview, this.context.extensionUri);
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    this.panel.onDidDispose(() => {
      this.panel = null;
    });
    this.postState();
  }

  postState() {
    if (!this.panel) {
      return;
    }
    this.panel.webview.postMessage({
      type: "state",
      error: this.lastError,
      model: this.model,
    });
  }

  sessionForKey(key) {
    return findSessionByKey(this.sessions, key);
  }

  async markSessionRead(session) {
    await updateReadKeys(this.context.globalState, markDoneRead(readKeys(this.context.globalState), session));
  }

  async markSessionUnread(session) {
    await updateReadKeys(this.context.globalState, markDoneUnread(readKeys(this.context.globalState), session));
  }

  async hideSession(session) {
    await updateHiddenKeys(this.context.globalState, markSessionHidden(hiddenKeys(this.context.globalState), session));
  }

  async restoreSession(session) {
    await updateHiddenKeys(this.context.globalState, restoreSession(hiddenKeys(this.context.globalState), session));
  }

  async handleSessionAction(key, action) {
    const session = this.sessionForKey(key);
    if (!session) {
      await vscode.window.showWarningMessage("Codex Radar session is no longer available.");
      this.refresh();
      return;
    }

    if (action === "open") {
      const opened = await openOfficialCodexThread(session);
      if (opened && isDoneSession(session)) {
        await this.markSessionRead(session);
      }
    } else if (action === "markRead") {
      await this.markSessionRead(session);
    } else if (action === "markUnread") {
      await this.markSessionUnread(session);
    } else if (action === "hide") {
      await this.hideSession(session);
    } else if (action === "restore") {
      await this.restoreSession(session);
    }

    this.selectedKey = key;
    this.onDidMutate();
  }

  async handleMessage(message) {
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.type === "ready" || message.type === "refresh") {
      this.refresh();
      return;
    }
    if (message.type === "setStatusFilter") {
      this.statusFilter = normalizeStatusFilter(message.value);
      this.refresh();
      return;
    }
    if (message.type === "selectSession") {
      this.selectedKey = String(message.key || "");
      this.refresh();
      return;
    }
    if (message.type === "sessionAction") {
      await this.handleSessionAction(String(message.key || ""), String(message.action || ""));
    }
  }
}

async function openSessionInCodex(target, providers, attentionTreeView, dashboardController) {
  const session = sessionFromTarget(target);
  const opened = await openOfficialCodexThread(session);
  if (opened && session && isDoneSession(session)) {
    await providers[0].markSessionRead(session);
    refreshProviders(providers);
    syncTreeViewBadge(attentionTreeView, providers[0]);
    dashboardController.refresh();
  }
  return opened;
}

async function markSessionReadCommand(target, providers, attentionTreeView, dashboardController) {
  const session = sessionFromTarget(target);
  if (!session || !isDoneSession(session)) {
    await vscode.window.showWarningMessage("Select a done Codex Radar session to mark read.");
    return;
  }
  await providers[0].markSessionRead(session);
  refreshProviders(providers);
  syncTreeViewBadge(attentionTreeView, providers[0]);
  dashboardController.refresh();
}

async function markSessionUnreadCommand(target, providers, attentionTreeView, dashboardController) {
  const session = sessionFromTarget(target);
  if (!session || !isDoneSession(session)) {
    await vscode.window.showWarningMessage("Select a done Codex Radar session to mark unread.");
    return;
  }
  await providers[0].markSessionUnread(session);
  refreshProviders(providers);
  syncTreeViewBadge(attentionTreeView, providers[0]);
  dashboardController.refresh();
}

async function hideSessionCommand(target, providers, attentionTreeView, dashboardController) {
  const session = sessionFromTarget(target);
  if (!session) {
    await vscode.window.showWarningMessage("Select a Codex Radar session to hide.");
    return;
  }
  await providers[0].hideSession(session);
  refreshProviders(providers);
  syncTreeViewBadge(attentionTreeView, providers[0]);
  dashboardController.refresh();
}

async function restoreSessionCommand(target, providers, attentionTreeView, dashboardController) {
  const session = sessionFromTarget(target);
  if (!session) {
    await vscode.window.showWarningMessage("Select a hidden Codex Radar session to restore.");
    return;
  }
  await providers[0].restoreSession(session);
  refreshProviders(providers);
  syncTreeViewBadge(attentionTreeView, providers[0]);
  dashboardController.refresh();
}

function createSessionCacheWatcher(onRefresh) {
  const target = sessionCacheWatchTarget(configuredStateDir());
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(target.base, target.pattern),
  );
  const refreshHandlers = registerRefreshHandlers(watcher, onRefresh);

  return {
    dispose() {
      refreshHandlers.dispose();
      watcher.dispose();
    },
  };
}

class SessionCacheWatcherManager {
  constructor(onRefresh) {
    this.onRefresh = onRefresh;
    this.current = null;
    this.reset();
  }

  reset() {
    this.disposeCurrent();
    this.current = createSessionCacheWatcher(this.onRefresh);
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
  const refreshAll = () => {
    refreshProviders(providers);
    syncTreeViewBadge(attentionTreeView, attentionProvider);
    dashboardController.refresh();
  };
  const dashboardController = new DashboardPanelController(context, refreshAll);
  syncTreeViewBadge(attentionTreeView, attentionProvider);
  const watcherManager = new SessionCacheWatcherManager(refreshAll);

  context.subscriptions.push(
    attentionTreeView,
    projectsTreeView,
    hiddenTreeView,
    vscode.commands.registerCommand("codexRadar.refresh", refreshAll),
    vscode.commands.registerCommand("codexRadar.openDashboard", () => dashboardController.open()),
    vscode.commands.registerCommand("codexRadar.filterStatus", async () => {
      await chooseStatusFilter(projectsProvider);
      syncTreeViewBadge(attentionTreeView, attentionProvider);
      dashboardController.refresh();
    }),
    vscode.commands.registerCommand("codexRadar.markRead", (target) =>
      markSessionReadCommand(target, providers, attentionTreeView, dashboardController),
    ),
    vscode.commands.registerCommand("codexRadar.markUnread", (target) =>
      markSessionUnreadCommand(target, providers, attentionTreeView, dashboardController),
    ),
    vscode.commands.registerCommand("codexRadar.hideSession", (target) =>
      hideSessionCommand(target, providers, attentionTreeView, dashboardController),
    ),
    vscode.commands.registerCommand("codexRadar.restoreSession", (target) =>
      restoreSessionCommand(target, providers, attentionTreeView, dashboardController),
    ),
    vscode.commands.registerCommand("codexRadar.openInCodex", (target) =>
      openSessionInCodex(target, providers, attentionTreeView, dashboardController),
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codexRadar.stateDir")) {
        watcherManager.reset();
        refreshAll();
      }
    }),
    watcherManager,
  );
}

function deactivate() {}

module.exports = {
  DashboardPanelController,
  SessionsProvider,
  activate,
  configuredStateDir,
  dashboardHtml,
  deactivate,
  hideSessionCommand,
  loadDecoratedSessions,
  officialCodexThreadUri,
  openOfficialCodexThread,
  openSessionInCodex,
  refreshProviders,
  restoreSessionCommand,
  statusFilterItems,
  syncTreeViewBadge,
};
