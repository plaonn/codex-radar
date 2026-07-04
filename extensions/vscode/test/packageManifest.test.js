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

  assert.equal(manifest.version, "0.1.2");
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
  assert.equal(viewTitleMenu.when, "view == codexRadar.sessionList");
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
      id: "codexRadar.sessionList",
      name: "Sessions",
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
  assert.equal(viewTitleMenu.when, "view == codexRadar.sessionList");
  assert.equal(viewTitleMenu.group, "navigation@1");
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      manifest.contributes.configuration.properties,
      "codexRadar.statusFilter",
    ),
    false,
  );
});

test("contributes transcript preview as an explicit session row action", () => {
  const manifest = readManifest();
  const previewCommand = manifest.contributes.commands.find(
    (command) => command.command === "codexRadar.previewTranscript",
  );
  const itemMenu = manifest.contributes.menus["view/item/context"].find(
    (item) => item.command === "codexRadar.previewTranscript",
  );

  assert.equal(previewCommand.icon, "$(open-preview)");
  assert.equal(
    manifest.activationEvents.includes("onCommand:codexRadar.previewTranscript"),
    true,
  );
  assert.equal(itemMenu.when, "view == codexRadar.sessionList && viewItem == codexRadar.session");
  assert.equal(itemMenu.group, "inline@1");
});

test("contributes experimental open in Codex as a session row action", () => {
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
  assert.equal(itemMenu.when, "view == codexRadar.sessionList && viewItem == codexRadar.session");
  assert.equal(itemMenu.group, "inline@2");
});
