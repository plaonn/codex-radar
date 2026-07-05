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

  assert.equal(manifest.version, "0.1.11");
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

test("contributes refresh command as a view title action", () => {
  const manifest = readManifest();
  const refreshCommand = manifest.contributes.commands.find(
    (command) => command.command === "codexRadar.refresh",
  );
  const viewTitleMenu = manifest.contributes.menus["view/title"].find(
    (item) => item.command === "codexRadar.refresh",
  );

  assert.equal(refreshCommand.icon, "$(refresh)");
  assert.equal(viewTitleMenu.when, "view == codexRadar.projectList");
  assert.equal(viewTitleMenu.group, "navigation@2");
});

test("contributes a dedicated Codex Radar activity bar container", () => {
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
    },
    {
      id: "codexRadar.projectList",
      name: "Projects",
    },
    {
      id: "codexRadar.hiddenList",
      name: "Hidden",
      visibility: "collapsed",
    },
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest.contributes.views, "explorer"), false);
});

test("contributes status filter as a temporary view title action", () => {
  const manifest = readManifest();
  const filterCommand = manifest.contributes.commands.find(
    (command) => command.command === "codexRadar.filterStatus",
  );
  const viewTitleMenu = manifest.contributes.menus["view/title"].find(
    (item) => item.command === "codexRadar.filterStatus",
  );

  assert.equal(filterCommand.icon, "$(filter)");
  assert.equal(viewTitleMenu.when, "view == codexRadar.projectList");
  assert.equal(viewTitleMenu.group, "navigation@1");
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      manifest.contributes.configuration.properties,
      "codexRadar.statusFilter",
    ),
    false,
  );
});

test("contributes retention config and prune actions", () => {
  const manifest = readManifest();
  const configureCommand = manifest.contributes.commands.find(
    (command) => command.command === "codexRadar.configureRetention",
  );
  const pruneCommand = manifest.contributes.commands.find(
    (command) => command.command === "codexRadar.pruneNow",
  );
  const configureMenu = manifest.contributes.menus["view/title"].find(
    (item) => item.command === "codexRadar.configureRetention",
  );
  const pruneMenu = manifest.contributes.menus["view/title"].find(
    (item) => item.command === "codexRadar.pruneNow",
  );
  const properties = manifest.contributes.configuration.properties;

  assert.equal(configureCommand.icon, "$(settings-gear)");
  assert.equal(pruneCommand.icon, "$(trash)");
  assert.equal(manifest.activationEvents.includes("onCommand:codexRadar.configureRetention"), true);
  assert.equal(manifest.activationEvents.includes("onCommand:codexRadar.pruneNow"), true);
  assert.equal(configureMenu.when, "view == codexRadar.projectList");
  assert.equal(pruneMenu.when, "view == codexRadar.projectList");
  assert.equal(configureMenu.group, "navigation@3");
  assert.equal(pruneMenu.group, "navigation@4");
  assert.equal(properties["codexRadar.cliPath"].default, "codex-radar");
  assert.equal(properties["codexRadar.pythonPath"].default, "python3");
});

test("contributes hide and restore row actions", () => {
  const manifest = readManifest();
  const hideCommand = manifest.contributes.commands.find(
    (command) => command.command === "codexRadar.hideSession",
  );
  const restoreCommand = manifest.contributes.commands.find(
    (command) => command.command === "codexRadar.restoreSession",
  );
  const hideMenus = manifest.contributes.menus["view/item/context"].filter(
    (item) => item.command === "codexRadar.hideSession",
  );
  const restoreMenu = manifest.contributes.menus["view/item/context"].find(
    (item) => item.command === "codexRadar.restoreSession",
  );

  assert.equal(hideCommand.title, "Codex Radar: Hide from Radar");
  assert.equal(hideCommand.icon, "$(eye-closed)");
  assert.equal(restoreCommand.title, "Codex Radar: Restore to Radar");
  assert.equal(restoreCommand.icon, "$(eye)");
  assert.equal(manifest.activationEvents.includes("onCommand:codexRadar.hideSession"), true);
  assert.equal(manifest.activationEvents.includes("onCommand:codexRadar.restoreSession"), true);
  assert.equal(hideMenus.length, 6);
  assert.equal(
    restoreMenu.when,
    "view == codexRadar.hiddenList && viewItem == codexRadar.session.hidden",
  );
});

test("does not contribute transcript preview to the VS Code surface", () => {
  const manifest = readManifest();
  const previewCommand = manifest.contributes.commands.find(
    (command) => command.command === "codexRadar.previewTranscript",
  );
  const itemMenu = manifest.contributes.menus["view/item/context"].find(
    (item) => item.command === "codexRadar.previewTranscript",
  );

  assert.equal(previewCommand, undefined);
  assert.equal(itemMenu, undefined);
  assert.equal(manifest.activationEvents.includes("onCommand:codexRadar.previewTranscript"), false);
});

test("contributes experimental open in Codex as the row command", () => {
  const manifest = readManifest();
  const openCommand = manifest.contributes.commands.find(
    (command) => command.command === "codexRadar.openInCodex",
  );
  const itemMenu = manifest.contributes.menus["view/item/context"].find(
    (item) => item.command === "codexRadar.openInCodex",
  );

  assert.equal(openCommand.icon, "$(link-external)");
  assert.equal(openCommand.title, "Codex Radar: Open in Codex (Experimental)");
  assert.equal(manifest.activationEvents.includes("onCommand:codexRadar.openInCodex"), true);
  assert.equal(itemMenu, undefined);
});

test("contributes done read and unread row actions", () => {
  const manifest = readManifest();
  const markReadCommand = manifest.contributes.commands.find(
    (command) => command.command === "codexRadar.markRead",
  );
  const markUnreadCommand = manifest.contributes.commands.find(
    (command) => command.command === "codexRadar.markUnread",
  );
  const markReadMenu = manifest.contributes.menus["view/item/context"].find(
    (item) => item.command === "codexRadar.markRead",
  );
  const markUnreadMenu = manifest.contributes.menus["view/item/context"].find(
    (item) => item.command === "codexRadar.markUnread",
  );

  assert.equal(markReadCommand.icon, "$(mail-read)");
  assert.equal(markUnreadCommand.icon, "$(mail)");
  assert.equal(markReadCommand.title, "Codex Radar: Mark as Read");
  assert.equal(markUnreadCommand.title, "Codex Radar: Mark as Unread");
  assert.equal(manifest.activationEvents.includes("onCommand:codexRadar.markRead"), true);
  assert.equal(manifest.activationEvents.includes("onCommand:codexRadar.markUnread"), true);
  assert.equal(
    markReadMenu.when,
    "view == codexRadar.attentionList && viewItem == codexRadar.session.done.unread",
  );
  assert.equal(
    markUnreadMenu.when,
    "view == codexRadar.attentionList && viewItem == codexRadar.session.done.read",
  );
  assert.equal(markReadMenu.group, "inline@1");
  assert.equal(markUnreadMenu.group, "inline@1");
});
