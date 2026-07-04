const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const manifestPath = path.resolve(__dirname, "..", "package.json");

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

test("contributes refresh command as a view title action", () => {
  const manifest = readManifest();
  const refreshCommand = manifest.contributes.commands.find(
    (command) => command.command === "codexRadar.refresh",
  );
  const viewTitleMenu = manifest.contributes.menus["view/title"].find(
    (item) => item.command === "codexRadar.refresh",
  );

  assert.equal(refreshCommand.icon, "$(refresh)");
  assert.equal(viewTitleMenu.when, "view == codexRadar.sessions");
  assert.equal(viewTitleMenu.group, "navigation@2");
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
  assert.equal(viewTitleMenu.when, "view == codexRadar.sessions");
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
  assert.equal(itemMenu.when, "view == codexRadar.sessions && viewItem == codexRadar.session");
  assert.equal(itemMenu.group, "inline@1");
});
