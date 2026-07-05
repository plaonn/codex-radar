const path = require("node:path");
const vscode = require("vscode");

const { officialCodexThreadUriString } = require("./codexLink");
const {
  defaultStateDir,
  loadSessionCache,
  normalizeStatusFilter,
} = require("./sessionSource");
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

class DashboardController {
  constructor(context) {
    this.context = context;
    this.statusFilter = "";
    this.selectedKey = "";
    this.sessions = [];
    this.model = null;
    this.lastError = "";
    this.view = null;
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

  postState() {
    if (!this.view) {
      return;
    }
    this.view.webview.postMessage({
      type: "state",
      error: this.lastError,
      model: this.model,
    });
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    webviewView.webview.html = dashboardHtml(webviewView.webview, this.context.extensionUri);
    webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    this.postState();
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
    this.refresh();
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

function createSessionCacheWatcher(controller) {
  const target = sessionCacheWatchTarget(configuredStateDir());
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(target.base, target.pattern),
  );
  const refreshHandlers = registerRefreshHandlers(watcher, () => controller.refresh());

  return {
    dispose() {
      refreshHandlers.dispose();
      watcher.dispose();
    },
  };
}

class SessionCacheWatcherManager {
  constructor(controller) {
    this.controller = controller;
    this.current = null;
    this.reset();
  }

  reset() {
    this.disposeCurrent();
    this.current = createSessionCacheWatcher(this.controller);
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
  const controller = new DashboardController(context);
  const watcherManager = new SessionCacheWatcherManager(controller);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("codexRadar.dashboard", controller, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("codexRadar.refresh", () => controller.refresh()),
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
  DashboardController,
  activate,
  configuredStateDir,
  dashboardHtml,
  deactivate,
  loadDecoratedSessions,
  officialCodexThreadUri,
  openOfficialCodexThread,
};
