const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const manifestPath = path.resolve(__dirname, "..", "package.json");

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

test("uses the current manual testing package version", () => {
  const manifest = readManifest();

  assert.equal(manifest.version, "0.3.23");
});

test("declares release metadata and workspace extension host scope", () => {
  const manifest = readManifest();

  assert.equal(manifest.publisher, "plaonn");
  assert.equal(manifest.license, "MIT");
  assert.equal(
    manifest.homepage,
    "https://github.com/plaonn/codex-radar/tree/main/extensions/vscode",
  );
  assert.equal(manifest.bugs.url, "https://github.com/plaonn/codex-radar/issues");
  assert.deepEqual(manifest.extensionKind, ["workspace"]);
  assert.equal(manifest.keywords.includes("remote"), true);
  assert.equal(manifest.keywords.includes("ssh"), true);
});

test("contributes native sidebar sections whose contents are Webviews", () => {
  const manifest = readManifest();
  const container = manifest.contributes.viewsContainers.activitybar.find(
    (item) => item.id === "codexRadar",
  );
  const views = manifest.contributes.views.codexRadar;

  assert.equal(container.title, "Codex Radar");
  assert.equal(container.icon, "media/codex-radar.svg");
  assert.deepEqual(views, [
    {
      id: "codexRadar.attentionList",
      name: "Attention",
      type: "webview",
    },
    {
      id: "codexRadar.projectList",
      name: "Projects",
      type: "webview",
    },
    {
      id: "codexRadar.archivedList",
      name: "Archived",
      type: "webview",
      visibility: "collapsed",
    },
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest.contributes.views, "explorer"), false);
});

test("contributes only global commands for refresh, filtering, and editor dashboard", () => {
  const manifest = readManifest();
  const commandIds = manifest.contributes.commands.map((command) => command.command).sort();
  const titleCommands = manifest.contributes.menus["view/title"];
  const dashboardCommand = manifest.contributes.commands.find(
    (command) => command.command === "codexRadar.openDashboard",
  );

  assert.deepEqual(commandIds, [
    "codexRadar.filterStatus",
    "codexRadar.openDashboard",
    "codexRadar.refresh",
  ]);
  assert.equal(dashboardCommand.icon, "$(layout)");
  assert.equal(dashboardCommand.title, "Codex Radar: Open Dashboard");
  assert.equal(titleCommands.some((item) => item.command === "codexRadar.openDashboard"), false);
  assert.equal(
    titleCommands.find((item) => item.command === "codexRadar.filterStatus").when,
    "view == codexRadar.projectList",
  );
  assert.equal(
    titleCommands.find((item) => item.command === "codexRadar.refresh").when,
    "view == codexRadar.attentionList || view == codexRadar.projectList || view == codexRadar.archivedList",
  );
});

test("activates on section Webviews and dashboard command", () => {
  const manifest = readManifest();

  assert.equal(manifest.activationEvents.includes("onStartupFinished"), true);
  assert.equal(manifest.activationEvents.includes("onView:codexRadar.attentionList"), true);
  assert.equal(manifest.activationEvents.includes("onView:codexRadar.projectList"), true);
  assert.equal(manifest.activationEvents.includes("onView:codexRadar.archivedList"), true);
  assert.equal(manifest.activationEvents.includes("onView:codexRadar.dashboard"), false);
  assert.equal(manifest.activationEvents.includes("onCommand:codexRadar.openDashboard"), true);
  assert.equal(manifest.activationEvents.includes("onCommand:codexRadar.openInCodex"), false);
});

test("keeps row/session actions inside the Webview message boundary", () => {
  const manifest = readManifest();
  const commandIds = manifest.contributes.commands.map((command) => command.command);

  assert.equal(commandIds.includes("codexRadar.openInCodex"), false);
  assert.equal(commandIds.includes("codexRadar.hideSession"), false);
  assert.equal(commandIds.includes("codexRadar.restoreSession"), false);
  assert.equal(commandIds.includes("codexRadar.markRead"), false);
  assert.equal(commandIds.includes("codexRadar.markUnread"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest.contributes.menus, "view/item/context"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest.contributes.menus, "commandPalette"), false);
});

test("does not expose retention config, prune commands, CLI settings, or transcript preview commands", () => {
  const manifest = readManifest();
  const commandIds = manifest.contributes.commands.map((command) => command.command);
  const viewTitleCommands = manifest.contributes.menus["view/title"].map((item) => item.command);
  const properties = manifest.contributes.configuration.properties;

  assert.equal(commandIds.includes("codexRadar.configureRetention"), false);
  assert.equal(commandIds.includes("codexRadar.pruneNow"), false);
  assert.equal(commandIds.includes("codexRadar.previewTranscript"), false);
  assert.equal(manifest.activationEvents.includes("onCommand:codexRadar.configureRetention"), false);
  assert.equal(manifest.activationEvents.includes("onCommand:codexRadar.pruneNow"), false);
  assert.equal(manifest.activationEvents.includes("onCommand:codexRadar.previewTranscript"), false);
  assert.equal(viewTitleCommands.includes("codexRadar.configureRetention"), false);
  assert.equal(viewTitleCommands.includes("codexRadar.pruneNow"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(properties, "codexRadar.cliPath"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(properties, "codexRadar.pythonPath"), false);
});
