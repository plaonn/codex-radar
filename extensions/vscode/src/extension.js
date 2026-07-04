const path = require("node:path");
const vscode = require("vscode");

const {
  defaultStateDir,
  groupSessionsByProject,
  loadSessionCache,
} = require("./sessionSource");
const {
  projectLabel,
  sessionDescription,
  sessionLabel,
} = require("./sessionViewModel");

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
    this.groups = [];
    this.refresh();
  }

  refresh() {
    try {
      const stateDir = configuredStateDir();
      this.groups = groupSessionsByProject(loadSessionCache(stateDir));
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
      const item = new vscode.TreeItem("No sessions indexed yet");
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

function activate(context) {
  const provider = new SessionsProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("codexRadar.sessions", provider),
    vscode.commands.registerCommand("codexRadar.refresh", () => provider.refresh()),
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
