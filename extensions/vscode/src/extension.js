const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

const { CodexAppServerController } = require("./codexAppServerController");

const { officialCodexThreadUriString } = require("./codexLink");
const {
  STATUS_FILTER_VALUES,
  defaultStateDir,
  loadSessionCache,
  normalizeStatusFilter,
} = require("./sessionSource");
const {
  loadExportPreview,
  loadSessionState,
  normalizeReadSourceMode,
} = require("./exportSource");
const {
  WatcherSetManager,
  archivedTranscriptWatchTarget,
  registerArchiveRefreshHandlers,
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
  pruneReadDoneKeys,
  readStateFromValue,
  readStateToValue,
  sessionStateKey,
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
const {
  buildSessionPreviewModel,
  buildSessionPreviewModelFromExport,
} = require("./transcriptPreview");
const { statusText } = require("./sessionViewModel");
const {
  normalizeOpenThreadBehavior,
  resolveWorkspaceHandoffAction,
} = require("./workspaceHandoff");

const OPEN_WORKSPACE_LABEL = "Open Project in New Window";
const OPEN_HERE_LABEL = "Open Here";

function configuredStateDir() {
  const configured = vscode.workspace.getConfiguration("codexRadar").get("stateDir", "");
  if (typeof configured === "string" && configured.trim()) {
    return path.resolve(configured.replace(/^~(?=$|[\\/])/, process.env.HOME || "~"));
  }
  return defaultStateDir();
}

function configuredOpenThreadBehavior() {
  return normalizeOpenThreadBehavior(
    vscode.workspace.getConfiguration("codexRadar").get("openThreadBehavior", "ask"),
  );
}

function configuredCodexExecutable() {
  const configured = vscode.workspace.getConfiguration("codexRadar").get("codexExecutable", "");
  return typeof configured === "string" && configured.trim() ? configured.trim() : "codex";
}

function configuredReadSource() {
  return normalizeReadSourceMode(
    vscode.workspace.getConfiguration("codexRadar").get("readSource", "observe"),
  );
}

function readKeys(globalState) {
  return readStateFromValue(globalState.get(READ_DONE_KEYS_KEY, []));
}

async function updateReadKeys(globalState, keys) {
  await globalState.update(READ_DONE_KEYS_KEY, readStateToValue(keys));
}

function sameReadKeys(left, right) {
  if (left.size !== right.size) {
    return false;
  }
  return Array.from(left).every((key) => right.has(key));
}

async function prunedReadKeys(globalState, sessions) {
  const current = readKeys(globalState);
  const pruned = pruneReadDoneKeys(current, sessions);
  if (!sameReadKeys(current, pruned)) {
    try {
      await updateReadKeys(globalState, pruned);
    } catch {
      // Keep the dashboard usable even if VS Code cannot persist Memento cleanup.
    }
  }
  return pruned;
}

function loadDecoratedSessions(globalState, stateDir = configuredStateDir()) {
  return decorateSessions(loadSessionCache(stateDir), readKeys(globalState));
}

function currentWorkspaceFolders() {
  return (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath).filter(Boolean);
}

function workspaceUriForPath(fsPath) {
  const currentUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (currentUri && currentUri.scheme !== "file") {
    return currentUri.with({ path: fsPath, query: "", fragment: "" });
  }
  return vscode.Uri.file(fsPath);
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
    return { opened: false, handedOff: false };
  }

  const uri = officialCodexThreadUri(session);
  if (!uri) {
    await vscode.window.showWarningMessage("Codex session id is not available for this session.");
    return { opened: false, handedOff: false };
  }
  const actionState = sessionCard(session, {
    homeDir: process.env.HOME || "",
    codexThreadCatalog: options.codexThreadCatalog,
  }).actions;
  if (isArchivedSession(session, { homeDir: process.env.HOME || "", codexThreadCatalog: options.codexThreadCatalog })) {
    await vscode.window.showWarningMessage("Archived Codex sessions cannot be opened in the Codex extension.");
    return { opened: false, handedOff: false };
  }
  if (!actionState.canOpen) {
    await vscode.window.showWarningMessage("This Codex session is not available to open in the Codex extension.");
    return { opened: false, handedOff: false };
  }

  const handoffAction = await resolveWorkspaceHandoffAction(session, {
    workspaceFolders: options.workspaceFolders || currentWorkspaceFolders(),
    behavior: options.openThreadBehavior || configuredOpenThreadBehavior(),
    choose: async ({ cwd }) => {
      const selected = await vscode.window.showWarningMessage(
        "This Codex thread belongs to a different workspace.",
        {
          modal: true,
          detail: `Session workspace: ${cwd}\n\nOpen the project before resuming the thread?`,
        },
        OPEN_WORKSPACE_LABEL,
        OPEN_HERE_LABEL,
      );
      if (selected === OPEN_WORKSPACE_LABEL) {
        return "openWorkspace";
      }
      if (selected === OPEN_HERE_LABEL) {
        return "openHere";
      }
      return "cancel";
    },
  });
  if (handoffAction.action === "cancel") {
    return { opened: false, handedOff: false };
  }

  if (handoffAction.action === "openWorkspace") {
    try {
      const stat = await fs.promises.stat(handoffAction.cwd);
      if (!stat.isDirectory()) {
        throw new Error("Session workspace is not a directory.");
      }
    } catch {
      const fallback = await vscode.window.showWarningMessage(
        "The session workspace is not available on this extension host.",
        { modal: true, detail: handoffAction.cwd },
        OPEN_HERE_LABEL,
      );
      if (fallback !== OPEN_HERE_LABEL) {
        return { opened: false, handedOff: false };
      }
      const opened = await vscode.env.openExternal(uri);
      if (!opened) {
        await vscode.window.showWarningMessage("Could not open this session in the Codex extension.");
      }
      return { opened, handedOff: false };
    }

    try {
      await vscode.commands.executeCommand(
        "vscode.openFolder",
        workspaceUriForPath(handoffAction.cwd),
        { forceNewWindow: true },
      );
      await vscode.window.showInformationMessage(
        "Project opened in a new window. Open the thread from Codex Radar there.",
      );
      return { opened: false, handedOff: true };
    } catch {
      await vscode.window.showWarningMessage("Could not open the session workspace in a new window.");
      return { opened: false, handedOff: false };
    }
  }

  const opened = await vscode.env.openExternal(uri);
  if (!opened) {
    await vscode.window.showWarningMessage("Could not open this session in the Codex extension.");
  }
  return { opened, handedOff: false };
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
      label: status === "all" ? "All statuses" : status === "attention" ? "Needs review" : statusText(status),
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
    tooltip: `${count} session${count === 1 ? "" : "s"} need review`,
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
        ? `${filtered} active session${filtered === 1 ? "" : "s"}`
        : `${filtered} of ${visible} active sessions match the current filter`,
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
  if (model?.setup && !counts.total) {
    return "$(radar) Radar setup";
  }
  const attention = counts.attention || 0;
  const running = counts.running || 0;
  const visible = counts.visible || 0;
  if (!visible) {
    return "$(radar) Radar 0";
  }
  return `$(radar) ${attention} review · ${running} running · ${visible} active`;
}

function radarStatusTooltip(model) {
  const counts = model?.counts || {};
  const lines = [
    `Attention: ${counts.attention || 0}`,
    `Running: ${counts.running || 0}`,
    `Active sessions: ${counts.visible || 0}`,
    `Archived sessions: ${counts.archived || 0}`,
  ];
  if (model?.source) {
    let source = `Read source: ${model.source.readSource}`;
    if (model.source.exportObservation) {
      source += ` · observation ${model.source.exportObservation}`;
    }
    if (model.source.fallbackReason) {
      source += ` · ${model.source.fallbackReason}`;
    }
    lines.push(source);
  }
  if (model?.setup) {
    lines.push("", model.setup.title);
    if (model.setup.detail) {
      lines.push(model.setup.detail);
    }
    if (model.setup.action) {
      lines.push(model.setup.action);
    }
  }
  return lines.join("\n");
}

class RadarWebviewController {
  constructor(context, options = {}) {
    this.context = context;
    this.onModelChange = typeof options.onModelChange === "function" ? options.onModelChange : null;
    this.appServerController = options.appServerController || null;
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
    this.latestInteractionAt = 0;
    this.refresh();
  }

  async loadCodexThreadCatalog(sessions) {
    const cwds = sessions.map((session) => session.cwd).filter(Boolean);
    return loadCodexThreadCatalog({
      appServerController: this.appServerController,
      cwds,
    });
  }

  async refresh(options = {}) {
    const refreshSerial = this.refreshSerial + 1;
    this.refreshSerial = refreshSerial;
    let sessionSourceDiagnostic = null;
    try {
      const stateDir = configuredStateDir();
      const sourceState = await loadSessionState(stateDir, { mode: configuredReadSource() });
      sessionSourceDiagnostic = sourceState.diagnostic;
      const loadedSessions = sourceState.sessions;
      const readKeysForSessions = await prunedReadKeys(this.context.globalState, loadedSessions);
      const sessions = decorateSessions(loadedSessions, readKeysForSessions);
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
        workspaceFolders: currentWorkspaceFolders(),
        sessionSourceDiagnostic,
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
        workspaceFolders: currentWorkspaceFolders(),
        sessionSourceDiagnostic,
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

  beginInteraction(message) {
    const provided = Number(message?.interactionAt);
    const interactionAt = Number.isFinite(provided) && provided > 0 ? provided : Date.now();
    if (interactionAt < this.latestInteractionAt) {
      return null;
    }
    this.latestInteractionAt = interactionAt;
    return interactionAt;
  }

  isCurrentInteraction(interactionAt) {
    return interactionAt >= this.latestInteractionAt;
  }

  sessionForInteraction(sessionId, key = "") {
    return this.sessionForPreviewIdentity(sessionId) || this.sessionForKey(key);
  }

  async previewModel(displaySession) {
    const mode = configuredReadSource();
    if (mode === "direct") {
      return buildSessionPreviewModel(displaySession, { homeDir: process.env.HOME || "" });
    }
    try {
      const payload = await loadExportPreview(configuredStateDir(), previewSessionIdentity(displaySession));
      if (mode === "export") {
        return buildSessionPreviewModelFromExport(displaySession, payload, {
          homeDir: process.env.HOME || "",
        });
      }
    } catch {
      // Preview remains usable through the trusted direct adapter for this migration release.
    }
    return buildSessionPreviewModel(displaySession, { homeDir: process.env.HOME || "" });
  }

  async openPreview(session, options = {}) {
    if (!session) {
      return;
    }
    const displaySession = sessionWithCatalogTitle(session, this.codexThreadCatalog);
    const sessionIdentity = previewSessionIdentity(displaySession);
    const shouldScrollToBottom = options.initialScrollToBottom ?? (sessionIdentity !== this.previewSessionKey);
    this.previewSessionKey = sessionIdentity;
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
    const card = sessionCard(displaySession, {
      homeDir: process.env.HOME || "",
      codexThreadCatalog: this.codexThreadCatalog,
    });
    const panel = this.previewPanel;
    const model = await this.previewModel(displaySession);
    if (!panel || panel !== this.previewPanel || this.previewSessionKey !== sessionIdentity) {
      return;
    }
    panel.title = `Codex Radar: ${model.shortSessionId}`;
    this.pendingPreviewState = {
      type: "previewState",
      model,
      actions: card.actions,
      key: card.key,
      sessionId: card.sessionId,
      initialScrollToBottom: shouldScrollToBottom,
      sessionIdentity,
    };
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
      const interactionAt = this.beginInteraction(message);
      if (interactionAt === null) {
        return;
      }
      await this.handleSessionAction(
        String(message.sessionId || ""),
        String(message.action || ""),
        String(message.key || ""),
        interactionAt,
      );
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
      void this.openPreview(session, { reveal: false });
    }
  }

  async markSessionRead(session) {
    await updateReadKeys(this.context.globalState, markDoneRead(readKeys(this.context.globalState), session));
  }

  async markSessionUnread(session) {
    await updateReadKeys(this.context.globalState, markDoneUnread(readKeys(this.context.globalState), session));
  }

  async handleSessionAction(sessionId, action, key = "", interactionAt = Date.now()) {
    const session = this.sessionForInteraction(sessionId, key);
    if (!session) {
      await vscode.window.showWarningMessage("Codex Radar session is no longer available.");
      await this.refresh();
      return;
    }

    if (action === "open") {
      const result = await openOfficialCodexThread(session, {
        codexThreadCatalog: this.codexThreadCatalog,
      });
      if (result.opened && isDoneSession(session)) {
        await this.markSessionRead(session);
      }
    } else if (action === "markRead") {
      await this.markSessionRead(session);
    } else if (action === "markUnread") {
      await this.markSessionUnread(session);
    }

    if (this.isCurrentInteraction(interactionAt)) {
      this.selectedKey = sessionStateKey(session);
      this.selectedSessionIdentity = previewSessionIdentity(session);
    }
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
      const interactionAt = this.beginInteraction(message);
      if (interactionAt === null) {
        return;
      }
      const requestedKey = String(message.key || "");
      const requestedSessionId = String(message.sessionId || "");
      const requestedSession = this.sessionForInteraction(requestedSessionId, requestedKey);
      if (!requestedSession) {
        await vscode.window.showWarningMessage("Codex Radar session is no longer available.");
        await this.refresh();
        return;
      }
      const requestedIdentity = previewSessionIdentity(requestedSession);
      this.selectedKey = sessionStateKey(requestedSession);
      this.selectedSessionIdentity = requestedIdentity;
      await this.refresh({ updatePreview: false });
      if (!this.isCurrentInteraction(interactionAt)) {
        return;
      }
      if (surface !== "dashboard") {
        await this.openPreview(
          this.sessionForPreviewIdentity(requestedIdentity) || requestedSession,
        );
      }
      return;
    }
    if (message.type === "sessionAction") {
      const interactionAt = this.beginInteraction(message);
      if (interactionAt === null) {
        return;
      }
      await this.handleSessionAction(
        String(message.sessionId || ""),
        String(message.action || ""),
        String(message.key || ""),
        interactionAt,
      );
      return;
    }
    if (message.type === "copySessionId") {
      if (this.beginInteraction(message) === null) {
        return;
      }
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

function createArchivedTranscriptWatcher(onRefresh) {
  const target = archivedTranscriptWatchTarget(defaultCodexHome());
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(target.base, target.pattern),
  );
  const refreshHandlers = registerArchiveRefreshHandlers(watcher, onRefresh);

  return {
    dispose() {
      refreshHandlers.dispose();
      watcher.dispose();
    },
  };
}

class SessionCacheWatcherManager extends WatcherSetManager {
  constructor(onRefresh) {
    super(() => [
      createSessionCacheWatcher(onRefresh),
      createArchivedTranscriptWatcher(onRefresh),
    ]);
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

async function activate(context) {
  const radarStatusBar = new RadarStatusBar();
  const appServerController = new CodexAppServerController({
    clientVersion: context.extension?.packageJSON?.version || "0.0.0",
    codexCommandProvider: configuredCodexExecutable,
  });
  const controller = new RadarWebviewController(context, {
    appServerController,
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
      } else if (event.affectsConfiguration("codexRadar.readSource")) {
        controller.refresh();
      } else if (event.affectsConfiguration("codexRadar.codexExecutable")) {
        appServerController.reset();
        controller.refresh();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => controller.refresh()),
    watcherManager,
    appServerController,
    radarStatusBar,
    usageStatusBar,
  );
}

function deactivate() {}

module.exports = {
  RadarWebviewController,
  activate,
  configuredCodexExecutable,
  configuredStateDir,
  configuredReadSource,
  dashboardHtml,
  deactivate,
  loadDecoratedSessions,
  officialCodexThreadUri,
  openOfficialCodexThread,
  previewHtml,
  radarStatusText,
  radarStatusTooltip,
  statusFilterItems,
  workspaceUriForPath,
};
