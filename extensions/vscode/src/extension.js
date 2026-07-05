const path = require("node:path");
const vscode = require("vscode");

const { officialCodexThreadUriString } = require("./codexLink");
const {
  configGetArgs,
  configSetRetentionArgs,
  configuredCliInvocation,
  parseRetentionDaysOutput,
  pruneArgs,
  retentionDaysFromInput,
  runRadarCli,
  validateRetentionDaysInput,
} = require("./radarCli");
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
  READ_DONE_KEYS_KEY,
  decorateSessions,
  isDoneSession,
  markDoneRead,
  markDoneUnread,
  readStateFromValue,
  readStateToValue,
} = require("./readState");

class ProjectItem extends vscode.TreeItem {
  constructor(project, sessions) {
    super(projectLabel(project, sessions), vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "codexRadar.project";
    this.iconPath = new vscode.ThemeIcon("folder");
    this.project = project;
  }
}

class AttentionItem extends vscode.TreeItem {
  constructor(sessions) {
    super(`Attention (${sessions.length})`, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "codexRadar.attention";
    this.iconPath = new vscode.ThemeIcon("bell-dot");
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
  if (isDoneSession(session)) {
    return session.is_unread_done ? "codexRadar.session.done.unread" : "codexRadar.session.done.read";
  }
  return "codexRadar.session";
}

class SessionsProvider {
  constructor(globalState) {
    this.globalState = globalState;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.lastError = "";
    this.statusFilter = "";
    this.sessions = [];
    this.attentionSessions = [];
    this.groups = [];
    this.refresh();
  }

  refresh() {
    try {
      const stateDir = configuredStateDir();
      const readKeys = this.readKeys();
      const sessions = decorateSessions(loadSessionCache(stateDir), readKeys);
      this.sessions = sessions;
      this.attentionSessions = sessions.filter((session) => session.is_attention);
      const visibleSessions = filterSessionsByStatus(sessions, this.statusFilter);
      this.groups = groupSessionsByProject(visibleSessions);
      this.lastError = "";
    } catch (error) {
      this.sessions = [];
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
    if (element instanceof AttentionItem) {
      return Promise.resolve(
        this.attentionSessions.map((session) => new SessionItem(session, { showProject: true })),
      );
    }

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

    if (this.groups.length === 0 && (!this.attentionSessions.length || this.statusFilter)) {
      const label = this.statusFilter
        ? `No sessions match ${this.statusFilter}`
        : "No sessions indexed";
      const item = new vscode.TreeItem(label);
      item.description = this.statusFilter ? "Clear the filter to show all sessions." : "";
      item.iconPath = new vscode.ThemeIcon("info");
      return Promise.resolve([item]);
    }

    const roots = [];
    if (!this.statusFilter && this.attentionSessions.length > 0) {
      roots.push(new AttentionItem(this.attentionSessions));
    }
    roots.push(
      ...this.groups.map((group) => {
        return new ProjectItem(group.project, group.sessions);
      }),
    );
    return Promise.resolve(roots);
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

  async updateReadKeys(readKeys) {
    await this.globalState.update(READ_DONE_KEYS_KEY, readStateToValue(readKeys));
    this.refresh();
  }

  async markSessionRead(session) {
    await this.updateReadKeys(markDoneRead(this.readKeys(), session));
  }

  async markSessionUnread(session) {
    await this.updateReadKeys(markDoneUnread(this.readKeys(), session));
  }
}

function syncTreeViewBadge(treeView, provider) {
  treeView.badge = provider.attentionBadge();
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

async function openSessionInCodex(target, provider, treeView) {
  const session = sessionFromTarget(target);
  const opened = await openOfficialCodexThread(session);
  if (opened && session && isDoneSession(session)) {
    await provider.markSessionRead(session);
    syncTreeViewBadge(treeView, provider);
  }
  return opened;
}

async function markSessionReadCommand(target, provider, treeView) {
  const session = sessionFromTarget(target);
  if (!session || !isDoneSession(session)) {
    await vscode.window.showWarningMessage("Select a done Codex Radar session to mark read.");
    return;
  }
  await provider.markSessionRead(session);
  syncTreeViewBadge(treeView, provider);
}

async function markSessionUnreadCommand(target, provider, treeView) {
  const session = sessionFromTarget(target);
  if (!session || !isDoneSession(session)) {
    await vscode.window.showWarningMessage("Select a done Codex Radar session to mark unread.");
    return;
  }
  await provider.markSessionUnread(session);
  syncTreeViewBadge(treeView, provider);
}

async function configureRetentionCommand(provider, treeView) {
  const cliInvocation = configuredCliInvocation(vscode);
  const stateDir = configuredStateDir();
  let currentDays = 7;
  try {
    const result = await runRadarCli(cliInvocation, configGetArgs(stateDir, "retention_days"));
    currentDays = parseRetentionDaysOutput(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`Could not read codex-radar retention config: ${message}`);
    return;
  }

  const input = await vscode.window.showInputBox({
    title: "Codex Radar Retention",
    prompt: "Days to keep sessions in Radar state. Use 0 to disable pruning.",
    value: String(currentDays),
    validateInput: validateRetentionDaysInput,
  });
  if (input === undefined) {
    return;
  }

  const days = retentionDaysFromInput(input);
  try {
    await runRadarCli(cliInvocation, configSetRetentionArgs(stateDir, days));
    provider.refresh();
    syncTreeViewBadge(treeView, provider);
    await vscode.window.showInformationMessage(`Codex Radar retention set to ${days} day${days === 1 ? "" : "s"}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`Could not update codex-radar retention config: ${message}`);
  }
}

async function pruneNowCommand(provider, treeView) {
  const cliInvocation = configuredCliInvocation(vscode);
  const stateDir = configuredStateDir();
  try {
    const result = await runRadarCli(cliInvocation, pruneArgs(stateDir));
    provider.refresh();
    syncTreeViewBadge(treeView, provider);
    const payload = JSON.parse(result.stdout || "{}");
    const removed = Array.isArray(payload.removed_sessions) ? payload.removed_sessions.length : 0;
    await vscode.window.showInformationMessage(`Codex Radar pruned ${removed} session${removed === 1 ? "" : "s"}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`Could not prune codex-radar state: ${message}`);
  }
}

function activate(context) {
  const provider = new SessionsProvider(context.globalState);
  const treeView = vscode.window.createTreeView("codexRadar.sessionList", {
    treeDataProvider: provider,
  });
  syncTreeViewBadge(treeView, provider);
  const watcherManager = new SessionCacheWatcherManager(provider, () =>
    syncTreeViewBadge(treeView, provider),
  );
  context.subscriptions.push(
    treeView,
    vscode.commands.registerCommand("codexRadar.refresh", () => {
      provider.refresh();
      syncTreeViewBadge(treeView, provider);
    }),
    vscode.commands.registerCommand("codexRadar.filterStatus", async () => {
      await chooseStatusFilter(provider);
      syncTreeViewBadge(treeView, provider);
    }),
    vscode.commands.registerCommand("codexRadar.configureRetention", () =>
      configureRetentionCommand(provider, treeView),
    ),
    vscode.commands.registerCommand("codexRadar.pruneNow", () =>
      pruneNowCommand(provider, treeView),
    ),
    vscode.commands.registerCommand("codexRadar.markRead", (target) =>
      markSessionReadCommand(target, provider, treeView),
    ),
    vscode.commands.registerCommand("codexRadar.markUnread", (target) =>
      markSessionUnreadCommand(target, provider, treeView),
    ),
    vscode.commands.registerCommand("codexRadar.openInCodex", (target) =>
      openSessionInCodex(target, provider, treeView),
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      const stateDirChanged = event.affectsConfiguration("codexRadar.stateDir");
      if (stateDirChanged) {
        watcherManager.reset();
        provider.refresh();
        syncTreeViewBadge(treeView, provider);
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
  configureRetentionCommand,
  pruneNowCommand,
  syncTreeViewBadge,
  statusFilterItems,
};
