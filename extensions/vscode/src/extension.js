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
  READ_DONE_KEYS_KEY,
  decorateSessions,
  isDoneSession,
  markDoneRead,
  markDoneUnread,
  readStateFromValue,
  readStateToValue,
} = require("./readState");
const { buildDashboardModel, findSessionByKey, isArchivedSession } = require("./dashboardViewModel");
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
  if (isArchivedSession(session, { homeDir: process.env.HOME || "" })) {
    await vscode.window.showWarningMessage("Archived Codex sessions cannot be opened in the Codex extension.");
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function previewDetail(label, value) {
  if (!value) {
    return "";
  }
  return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
}

function previewHtml(webview, extensionUri, model) {
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "dashboard.css"));
  const cspSource = webview.cspSource;
  const notice = model.transcriptMessage
    ? `<div class="preview-notice">${escapeHtml(model.transcriptMessage)}</div>`
    : "";
  const entries = model.transcriptEntries.length
    ? model.transcriptEntries.map((entry) => `
      <article class="preview-entry ${escapeHtml(entry.role)}">
        <div class="preview-role">${escapeHtml(entry.label || entry.role)}</div>
        <div class="preview-bubble">${entry.html}</div>
      </article>
    `).join("")
    : `<div class="empty">${escapeHtml(model.transcriptMessage || "No transcript preview available.")}</div>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src ${cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
  <title>Codex Radar Preview</title>
</head>
<body>
  <main class="preview">
    <header class="preview-header">
      <div class="preview-title-block">
        <h1>${escapeHtml(model.title)}</h1>
        <div class="preview-meta">${escapeHtml(model.project)} | ${escapeHtml(model.status)} | ${escapeHtml(model.shortSessionId)}</div>
      </div>
    </header>
    ${model.summary ? `<section class="preview-summary">${escapeHtml(model.summary)}</section>` : ""}
    <dl class="details preview-details">
      ${previewDetail("Last seen", model.lastSeen)}
      ${previewDetail("Last event", model.lastEvent)}
      ${previewDetail("Model", model.model)}
      ${previewDetail("Tool", model.currentTool)}
    </dl>
    <section class="preview-transcript">
      <h2>Transcript Preview</h2>
      ${notice}
      <div class="preview-list">${entries}</div>
    </section>
  </main>
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
    controller.setStatusFilter(selected.value);
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

class RadarWebviewController {
  constructor(context) {
    this.context = context;
    this.statusFilter = "";
    this.selectedKey = "";
    this.sessions = [];
    this.model = null;
    this.lastError = "";
    this.sidebarViews = new Map();
    this.panel = null;
    this.previewPanel = null;
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

  postState() {
    for (const [surface, view] of this.sidebarViews.entries()) {
      this.postStateTo(view, surface);
    }
    if (this.panel) {
      this.postStateTo(this.panel, "dashboard");
    }
    this.updatePreviewPanel();
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
    this.refresh();
  }

  sessionForKey(key) {
    return findSessionByKey(this.sessions, key);
  }

  openPreview(session, options = {}) {
    if (!session) {
      return;
    }
    if (!this.previewPanel) {
      this.previewPanel = vscode.window.createWebviewPanel(
        "codexRadar.preview",
        "Codex Radar Preview",
        vscode.ViewColumn.Active,
        {
          enableScripts: false,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
        },
      );
      this.previewPanel.onDidDispose(() => {
        this.previewPanel = null;
      });
    } else if (options.reveal !== false) {
      this.previewPanel.reveal(vscode.ViewColumn.Active);
    }
    const model = buildSessionPreviewModel(session, { homeDir: process.env.HOME || "" });
    this.previewPanel.title = `Codex Radar: ${model.shortSessionId}`;
    this.previewPanel.webview.html = previewHtml(this.previewPanel.webview, this.context.extensionUri, model);
  }

  updatePreviewPanel() {
    if (!this.previewPanel || !this.selectedKey) {
      return;
    }
    const session = this.sessionForKey(this.selectedKey);
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
    }

    this.selectedKey = key;
    this.refresh();
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
      this.refresh();
      return;
    }
    if (message.type === "openDashboard") {
      this.openDashboard();
      return;
    }
    if (message.type === "setStatusFilter") {
      this.setStatusFilter(message.value);
      return;
    }
    if (message.type === "selectSession") {
      this.selectedKey = String(message.key || "");
      this.refresh();
      if (surface !== "dashboard") {
        this.openPreview(this.sessionForKey(this.selectedKey));
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

function activate(context) {
  const controller = new RadarWebviewController(context);
  const watcherManager = new SessionCacheWatcherManager(() => controller.refresh());

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
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codexRadar.stateDir")) {
        watcherManager.reset();
        controller.refresh();
      }
    }),
    watcherManager,
  );
}

function deactivate() {}

module.exports = {
  RadarWebviewController,
  activate,
  configuredStateDir,
  dashboardHtml,
  deactivate,
  escapeHtml,
  loadDecoratedSessions,
  officialCodexThreadUri,
  openOfficialCodexThread,
  previewHtml,
  statusFilterItems,
};
