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

  assert.equal(manifest.version, "0.2.0");
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

test("contributes refresh command as a dashboard view title action", () => {
  const manifest = readManifest();
  const refreshCommand = manifest.contributes.commands.find(
    (command) => command.command === "codexRadar.refresh",
  );
  const viewTitleMenu = manifest.contributes.menus["view/title"].find(
    (item) => item.command === "codexRadar.refresh",
  );

  assert.equal(refreshCommand.icon, "$(refresh)");
  assert.equal(viewTitleMenu.when, "view == codexRadar.dashboard");
  assert.equal(viewTitleMenu.group, "navigation@1");
});

test("contributes one dedicated Webview dashboard in the activity bar container", () => {
  const manifest = readManifest();
  const container = manifest.contributes.viewsContainers.activitybar.find(
    (item) => item.id === "codexRadar",
  );
  const views = manifest.contributes.views.codexRadar;

  assert.equal(container.title, "Codex Radar");
  assert.equal(container.icon, "media/codex-radar.svg");
  assert.deepEqual(views, [
    {
      id: "codexRadar.dashboard",
      name: "Dashboard",
      type: "webview",
    },
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest.contributes.views, "explorer"), false);
});

test("does not expose TreeView row actions, status filter commands, or retention controls", () => {
  const manifest = readManifest();
  const commandIds = manifest.contributes.commands.map((command) => command.command);
  const properties = manifest.contributes.configuration.properties;

  assert.deepEqual(commandIds, ["codexRadar.refresh"]);
  assert.equal(manifest.activationEvents.includes("onView:codexRadar.dashboard"), true);
  assert.equal(manifest.activationEvents.includes("onView:codexRadar.projectList"), false);
  assert.equal(manifest.activationEvents.includes("onCommand:codexRadar.filterStatus"), false);
  assert.equal(manifest.activationEvents.includes("onCommand:codexRadar.configureRetention"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest.contributes.menus, "view/item/context"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest.contributes.menus, "commandPalette"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(properties, "codexRadar.statusFilter"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(properties, "codexRadar.cliPath"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(properties, "codexRadar.pythonPath"), false);
});

test("does not contribute transcript preview to the VS Code surface", () => {
  const manifest = readManifest();
  const previewCommand = manifest.contributes.commands.find(
    (command) => command.command === "codexRadar.previewTranscript",
  );

  assert.equal(previewCommand, undefined);
  assert.equal(manifest.activationEvents.includes("onCommand:codexRadar.previewTranscript"), false);
});
