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
  sessionLabel,
  sessionTooltip,
} = require("./sessionViewModel");
const {
  registerRefreshHandlers,
  sessionCacheWatchTarget,
} = require("./sessionWatcher");
const {
  previewDocumentContent,
  skimTranscript,
} = require("./transcriptPreview");

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
    this.session = session;
    this.description = sessionDescription(session);
    this.tooltip = sessionTooltip(session);
    this.iconPath = statusIcon(session.display_status);
  }
}

class TranscriptPreviewProvider {
  constructor() {
    this.documents = new Map();
  }

  setContent(uri, content) {
    this.documents.set(uri.toString(), content);
  }

  provideTextDocumentContent(uri) {
    return this.documents.get(uri.toString()) || "";
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
    this.sessions = [];
    this.groups = [];
    this.refresh();
  }

  refresh() {
    try {
      const stateDir = configuredStateDir();
      const sessions = loadSessionCache(stateDir);
      this.sessions = sessions;
      const visibleSessions = filterSessionsByStatus(sessions, this.statusFilter);
      this.groups = groupSessionsByProject(visibleSessions);
      this.lastError = "";
    } catch (error) {
      this.sessions = [];
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
      label: status === "all" ? "All statuses" : status,
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

function previewUriForSession(session) {
  const sessionId = String(session.session_id || "unknown");
  const safeSessionId = sessionId.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "unknown";
  return vscode.Uri.from({
    scheme: "codex-radar-preview",
    path: `/${safeSessionId}.txt`,
    query: String(Date.now()),
  });
}

async function previewTranscript(target, previewProvider) {
  const session = target && target.session ? target.session : target;
  if (!session || typeof session !== "object") {
    await vscode.window.showWarningMessage("Select a Codex Radar session to preview.");
    return;
  }
  if (!session.transcript_path) {
    await vscode.window.showWarningMessage("Transcript path is not available for this session.");
    return;
  }

  let entries;
  try {
    entries = skimTranscript(session.transcript_path);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      await vscode.window.showWarningMessage("Transcript file not found.");
      return;
    }
    await vscode.window.showErrorMessage("Could not read transcript preview.");
    return;
  }

  const uri = previewUriForSession(session);
  previewProvider.setContent(uri, previewDocumentContent(session, entries));
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: true });
}

function officialCodexThreadUri(session) {
  const uri = officialCodexThreadUriString(session);
  if (!uri) {
    return null;
  }
  return vscode.Uri.parse(uri);
}

async function openOfficialCodexThread(target) {
  const session = target && target.session ? target.session : target;
  if (!session || typeof session !== "object") {
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

function activate(context) {
  const provider = new SessionsProvider();
  const previewProvider = new TranscriptPreviewProvider();
  const treeView = vscode.window.createTreeView("codexRadar.sessionList", {
    treeDataProvider: provider,
  });
  syncTreeViewBadge(treeView, provider);
  const watcherManager = new SessionCacheWatcherManager(provider, () =>
    syncTreeViewBadge(treeView, provider),
  );
  context.subscriptions.push(
    treeView,
    vscode.workspace.registerTextDocumentContentProvider("codex-radar-preview", previewProvider),
    vscode.commands.registerCommand("codexRadar.refresh", () => {
      provider.refresh();
      syncTreeViewBadge(treeView, provider);
    }),
    vscode.commands.registerCommand("codexRadar.filterStatus", async () => {
      await chooseStatusFilter(provider);
      syncTreeViewBadge(treeView, provider);
    }),
    vscode.commands.registerCommand("codexRadar.previewTranscript", (target) =>
      previewTranscript(target, previewProvider),
    ),
    vscode.commands.registerCommand("codexRadar.openInCodex", (target) =>
      openOfficialCodexThread(target),
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
  previewUriForSession,
  officialCodexThreadUri,
  openOfficialCodexThread,
  syncTreeViewBadge,
  statusFilterItems,
  TranscriptPreviewProvider,
};
