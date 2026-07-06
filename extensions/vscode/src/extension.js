const path = require("node:path");
const vscode = require("vscode");

const { officialCodexThreadUriString } = require("./codexLink");
const {
  STATUS_FILTER_VALUES,
  defaultStateDir,
  loadSessionCache,
  normalizeStatusFilter,
} = require("./sessionSource");
const {
  registerRefreshHandlers,
  sessionCacheWatchTarget,
} = require("./sessionWatcher");
const {
  defaultCodexHome,
  loadUsageSnapshot,
  usageStatusText,
  usageStatusTooltip,
} = require("./usageSource");
const {
  READ_DONE_KEYS_KEY,
  decorateSessions,
  isDoneSession,
  markDoneRead,
  markDoneUnread,
  readStateFromValue,
  readStateToValue,
} = require("./readState");
const {
  buildDashboardModel,
  findSessionByKey,
  isArchivedSession,
  sessionCard,
} = require("./dashboardViewModel");
const {
  emptyCodexThreadCatalog,
  loadCodexThreadCatalog,
  sessionWithCatalogTitle,
} = require("./codexThreadCatalog");
const { buildSessionPreviewModel } = require("./transcriptPreview");

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

async function updateReadKeys(globalState, keys) {
  await globalState.update(READ_DONE_KEYS_KEY, readStateToValue(keys));
}

function loadDecoratedSessions(globalState, stateDir = configuredStateDir()) {
  return decorateSessions(loadSessionCache(stateDir), readKeys(globalState));
}

function sessionFromTarget(target) {
  const session = target && target.session ? target.session : target;
  if (!session || typeof session !== "object") {
    return null;
  }
  return session;
}

function previewSessionIdentity(session) {
  if (!session || typeof session !== "object") {
    return "";
  }
  return String(session.session_id || session.sessionId || session.key || "");
}

function officialCodexThreadUri(session) {
  const uri = officialCodexThreadUriString(session);
  if (!uri) {
    return null;
  }
  return vscode.Uri.parse(uri);
}

async function openOfficialCodexThread(target, options = {}) {
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
  const actionState = sessionCard(session, {
    homeDir: process.env.HOME || "",
    codexThreadCatalog: options.codexThreadCatalog,
  }).actions;
  if (isArchivedSession(session, { homeDir: process.env.HOME || "", codexThreadCatalog: options.codexThreadCatalog })) {
    await vscode.window.showWarningMessage("Archived Codex sessions cannot be opened in the Codex extension.");
    return false;
  }
  if (!actionState.canOpen) {
    await vscode.window.showWarningMessage("This Codex session is not available to open in the Codex extension.");
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

function previewHtml(webview, extensionUri) {
  const nonce = webviewNonce();
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "dashboard.css"));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "preview.js"));
  const cspSource = webview.cspSource;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src ${cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
  <title>Codex Radar Preview</title>
</head>
<body>
  <main class="preview">
    <header class="preview-header">
      <div class="preview-title-row">
        <div class="preview-title-block">
          <h1 id="preview-title"></h1>
          <div id="preview-meta" class="preview-meta"></div>
        </div>
        <button id="preview-open" class="preview-open" type="button">Open in Codex</button>
      </div>
      <dl id="preview-details" class="details preview-details"></dl>
    </header>
    <section class="preview-body" aria-label="Transcript preview">
      <div id="preview-transcript" class="preview-transcript"></div>
    </section>
  </main>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
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

async function chooseStatusFilter(controller) {
  const selected = await vscode.window.showQuickPick(statusFilterItems(controller.statusFilter), {
    placeHolder: "Filter Codex Radar project sessions by status",
  });
  if (selected) {
    await controller.setStatusFilter(selected.value);
  }
}

function attentionBadge(model) {
  const count = model?.counts?.attention || 0;
  if (!count) {
    return undefined;
  }
  return {
    value: count,
    tooltip: `${count} attention session${count === 1 ? "" : "s"}`,
  };
}

function viewBadge(model, surface) {
  const counts = model?.counts || {};
  if (surface === "attention") {
    return attentionBadge(model);
  }
  if (surface === "projects") {
    const filtered = counts.filtered || 0;
    if (!filtered) {
      return undefined;
    }
    const visible = counts.visible || 0;
    return {
      value: filtered,
      tooltip: filtered === visible
        ? `${filtered} visible session${filtered === 1 ? "" : "s"}`
        : `${filtered} of ${visible} visible sessions match the current filter`,
    };
  }
  if (surface === "archived") {
    const archived = counts.archived || 0;
    if (!archived) {
      return undefined;
    }
    return {
      value: archived,
      tooltip: `${archived} archived session${archived === 1 ? "" : "s"}`,
    };
  }
  return undefined;
}

function radarStatusText(model) {
  const counts = model?.counts || {};
  const attention = counts.attention || 0;
  const running = counts.running || 0;
  const visible = counts.visible || 0;
  if (!visible) {
    return "$(radar) Radar 0";
  }
  return `$(radar) ${attention} attention · ${running} running · ${visible} visible`;
}

function radarStatusTooltip(model) {
  const counts = model?.counts || {};
  return [
    `Attention: ${counts.attention || 0}`,
    `Running: ${counts.running || 0}`,
    `Visible sessions: ${counts.visible || 0}`,
    `Archived sessions: ${counts.archived || 0}`,
  ].join("\n");
}

class RadarWebviewController {
  constructor(context, options = {}) {
    this.context = context;
    this.onModelChange = typeof options.onModelChange === "function" ? options.onModelChange : null;
    this.statusFilter = "";
    this.selectedKey = "";
    this.selectedSessionIdentity = "";
    this.sessions = [];
    this.model = buildDashboardModel([]);
    this.lastError = "";
    this.sidebarViews = new Map();
    this.panel = null;
    this.previewPanel = null;
    this.previewSessionKey = "";
    this.previewReady = false;
    this.pendingPreviewState = null;
    this.codexThreadCatalog = emptyCodexThreadCatalog();
    this.refreshSerial = 0;
    this.refresh();
  }

  async loadCodexThreadCatalog(sessions) {
    const cwds = sessions.map((session) => session.cwd).filter(Boolean);
    return loadCodexThreadCatalog({ cwds });
  }

  async refresh(options = {}) {
    const refreshSerial = this.refreshSerial + 1;
    this.refreshSerial = refreshSerial;
    try {
      const sessions = loadDecoratedSessions(this.context.globalState);
      const codexThreadCatalog = await this.loadCodexThreadCatalog(sessions);
      if (refreshSerial !== this.refreshSerial) {
        return;
      }
      this.sessions = sessions;
      this.codexThreadCatalog = codexThreadCatalog;
      this.model = buildDashboardModel(sessions, {
        homeDir: process.env.HOME || "",
        codexThreadCatalog,
        selectedKey: this.selectedKey,
        selectedIdentity: this.selectedSessionIdentity,
        statusFilter: this.statusFilter,
      });
      this.selectedKey = this.model.selected?.key || "";
      this.selectedSessionIdentity = previewSessionIdentity(this.model.selected);
      this.lastError = "";
    } catch (error) {
      if (refreshSerial !== this.refreshSerial) {
        return;
      }
      this.sessions = [];
      this.codexThreadCatalog = emptyCodexThreadCatalog();
      this.model = buildDashboardModel([], {
        selectedKey: this.selectedKey,
        selectedIdentity: this.selectedSessionIdentity,
        statusFilter: this.statusFilter,
      });
      this.lastError = error instanceof Error ? error.message : String(error);
    }
    this.postState(options);
    if (this.onModelChange) {
      this.onModelChange(this.model);
    }
  }

  resolveSidebarView(surface, webviewView) {
    this.sidebarViews.set(surface, webviewView);
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    webviewView.webview.html = dashboardHtml(webviewView.webview, this.context.extensionUri);
    webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(surface, message));
    this.postStateTo(webviewView, surface);
  }

  openDashboard() {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      this.postStateTo(this.panel, "dashboard");
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
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage("dashboard", message));
    this.panel.onDidDispose(() => {
      this.panel = null;
    });
    this.postStateTo(this.panel, "dashboard");
  }

  postState(options = {}) {
    for (const [surface, view] of this.sidebarViews.entries()) {
      this.postStateTo(view, surface);
    }
    if (this.panel) {
      this.postStateTo(this.panel, "dashboard");
    }
    if (options.updatePreview !== false) {
      this.updatePreviewPanel();
    }
  }

  postStateTo(target, surface) {
    if (!target) {
      return;
    }
    if ("badge" in target) {
      target.badge = viewBadge(this.model, surface);
    }
    target.webview.postMessage({
      type: "state",
      error: this.lastError,
      model: this.model,
      surface,
    });
  }

  setStatusFilter(statusFilter) {
    this.statusFilter = normalizeStatusFilter(statusFilter);
    return this.refresh();
  }

  sessionForKey(key) {
    return findSessionByKey(this.sessions, key);
  }

  sessionForPreviewIdentity(identity) {
    const target = String(identity || "");
    if (!target) {
      return null;
    }
    return this.sessions.find((session) => previewSessionIdentity(session) === target) || null;
  }

  openPreview(session, options = {}) {
    if (!session) {
      return;
    }
    const displaySession = sessionWithCatalogTitle(session, this.codexThreadCatalog);
    const sessionIdentity = previewSessionIdentity(displaySession);
    if (!this.previewPanel) {
      this.previewPanel = vscode.window.createWebviewPanel(
        "codexRadar.preview",
        "Codex Radar Preview",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
        },
      );
      this.previewPanel.webview.onDidReceiveMessage((message) => this.handlePreviewMessage(message));
      this.previewPanel.webview.html = previewHtml(this.previewPanel.webview, this.context.extensionUri);
      this.previewPanel.onDidDispose(() => {
        this.previewPanel = null;
        this.previewSessionKey = "";
        this.previewReady = false;
        this.pendingPreviewState = null;
      });
    } else if (options.reveal !== false) {
      this.previewPanel.reveal(vscode.ViewColumn.Active);
    }
    const shouldScrollToBottom = options.initialScrollToBottom ?? (sessionIdentity !== this.previewSessionKey);
    const card = sessionCard(displaySession, {
      homeDir: process.env.HOME || "",
      codexThreadCatalog: this.codexThreadCatalog,
    });
    const model = buildSessionPreviewModel(displaySession, { homeDir: process.env.HOME || "" });
    this.previewPanel.title = `Codex Radar: ${model.shortSessionId}`;
    this.pendingPreviewState = {
      type: "previewState",
      model,
      actions: card.actions,
      key: card.key,
      initialScrollToBottom: shouldScrollToBottom,
      sessionIdentity,
    };
    this.previewSessionKey = sessionIdentity;
    this.postPreviewState();
  }

  async handlePreviewMessage(message) {
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.type === "previewReady") {
      this.previewReady = true;
      this.postPreviewState();
      return;
    }
    if (message.type === "sessionAction") {
      await this.handleSessionAction(String(message.key || ""), String(message.action || ""));
    }
  }

  postPreviewState() {
    if (!this.previewPanel || !this.previewReady || !this.pendingPreviewState) {
      return;
    }
    this.previewPanel.webview.postMessage(this.pendingPreviewState);
  }

  updatePreviewPanel() {
    if (!this.previewPanel || !this.previewSessionKey) {
      return;
    }
    const session = this.sessionForPreviewIdentity(this.previewSessionKey);
    if (session) {
      this.openPreview(session, { reveal: false });
    }
  }

  async markSessionRead(session) {
    await updateReadKeys(this.context.globalState, markDoneRead(readKeys(this.context.globalState), session));
  }

  async markSessionUnread(session) {
    await updateReadKeys(this.context.globalState, markDoneUnread(readKeys(this.context.globalState), session));
  }

  async handleSessionAction(key, action) {
    const session = this.sessionForKey(key);
    if (!session) {
      await vscode.window.showWarningMessage("Codex Radar session is no longer available.");
      await this.refresh();
      return;
    }

    if (action === "open") {
      const opened = await openOfficialCodexThread(session, { codexThreadCatalog: this.codexThreadCatalog });
      if (opened && isDoneSession(session)) {
        await this.markSessionRead(session);
      }
    } else if (action === "markRead") {
      await this.markSessionRead(session);
    } else if (action === "markUnread") {
      await this.markSessionUnread(session);
    }

    this.selectedKey = key;
    this.selectedSessionIdentity = previewSessionIdentity(session);
    await this.refresh();
  }

  async copySessionId(sessionId) {
    const value = String(sessionId || "").trim();
    if (!value) {
      return;
    }
    await vscode.env.clipboard.writeText(value);
    vscode.window.setStatusBarMessage("Copied Codex session id", 1800);
  }

  async handleMessage(surface, message) {
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.type === "ready" || message.type === "refresh") {
      await this.refresh();
      return;
    }
    if (message.type === "openDashboard") {
      this.openDashboard();
      return;
    }
    if (message.type === "setStatusFilter") {
      await this.setStatusFilter(message.value);
      return;
    }
    if (message.type === "selectSession") {
      const requestedKey = String(message.key || "");
      const requestedSession = this.sessionForKey(requestedKey);
      const requestedIdentity = previewSessionIdentity(requestedSession);
      this.selectedKey = requestedKey;
      this.selectedSessionIdentity = requestedIdentity;
      await this.refresh({ updatePreview: false });
      if (surface !== "dashboard") {
        this.openPreview(
          this.sessionForPreviewIdentity(requestedIdentity) || this.sessionForKey(requestedKey) || requestedSession,
        );
      }
      return;
    }
    if (message.type === "sessionAction") {
      await this.handleSessionAction(String(message.key || ""), String(message.action || ""));
      return;
    }
    if (message.type === "copySessionId") {
      await this.copySessionId(message.sessionId);
    }
  }
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

class UsageStatusBar {
  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.interval = null;
    this.watcher = null;
    this.snapshot = null;
    this.item.command = "codexRadar.showUsageDetails";
    this.reset();
  }

  reset() {
    this.disposeWatcher();
    this.refresh();
    this.interval = setInterval(() => this.refresh(), 5 * 60 * 1000);
    const sessionsDir = path.join(defaultCodexHome(), "sessions");
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(path.resolve(sessionsDir), "**/rollout-*.jsonl"),
    );
    const refreshHandlers = registerRefreshHandlers(this.watcher, () => this.refresh());
    this.watcherRefreshHandlers = refreshHandlers;
  }

  refresh() {
    let snapshot;
    try {
      snapshot = loadUsageSnapshot();
    } catch (error) {
      snapshot = {
        available: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    this.snapshot = snapshot;
    this.item.text = usageStatusText(snapshot);
    this.item.tooltip = usageStatusTooltip(snapshot);
    this.item.show();
  }

  async showDetails() {
    const snapshot = this.snapshot || loadUsageSnapshot();
    await vscode.window.showInformationMessage("Codex usage remaining", {
      modal: true,
      detail: usageStatusTooltip(snapshot),
    });
  }

  disposeWatcher() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.watcherRefreshHandlers) {
      this.watcherRefreshHandlers.dispose();
      this.watcherRefreshHandlers = null;
    }
    if (this.watcher) {
      this.watcher.dispose();
      this.watcher = null;
    }
  }

  dispose() {
    this.disposeWatcher();
    this.item.dispose();
  }
}

class RadarStatusBar {
  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
    this.item.command = "codexRadar.openDashboard";
    this.refresh(buildDashboardModel([]));
  }

  refresh(model) {
    this.item.text = radarStatusText(model);
    this.item.tooltip = radarStatusTooltip(model);
    this.item.show();
  }

  dispose() {
    this.item.dispose();
  }
}

function activate(context) {
  const radarStatusBar = new RadarStatusBar();
  const controller = new RadarWebviewController(context, {
    onModelChange: (model) => radarStatusBar.refresh(model),
  });
  const watcherManager = new SessionCacheWatcherManager(() => controller.refresh());
  const usageStatusBar = new UsageStatusBar();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("codexRadar.attentionList", {
      resolveWebviewView: (view) => controller.resolveSidebarView("attention", view),
    }),
    vscode.window.registerWebviewViewProvider("codexRadar.projectList", {
      resolveWebviewView: (view) => controller.resolveSidebarView("projects", view),
    }),
    vscode.window.registerWebviewViewProvider("codexRadar.archivedList", {
      resolveWebviewView: (view) => controller.resolveSidebarView("archived", view),
    }),
    vscode.commands.registerCommand("codexRadar.refresh", () => controller.refresh()),
    vscode.commands.registerCommand("codexRadar.openDashboard", () => controller.openDashboard()),
    vscode.commands.registerCommand("codexRadar.filterStatus", () => chooseStatusFilter(controller)),
    vscode.commands.registerCommand("codexRadar.showUsageDetails", () => usageStatusBar.showDetails()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codexRadar.stateDir")) {
        watcherManager.reset();
        controller.refresh();
      }
    }),
    watcherManager,
    radarStatusBar,
    usageStatusBar,
  );
}

function deactivate() {}

module.exports = {
  RadarWebviewController,
  activate,
  configuredStateDir,
  dashboardHtml,
  deactivate,
  loadDecoratedSessions,
  officialCodexThreadUri,
  openOfficialCodexThread,
  previewHtml,
  radarStatusText,
  radarStatusTooltip,
  statusFilterItems,
};
