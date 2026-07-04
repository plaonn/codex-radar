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
  assert.equal(viewTitleMenu.group, "navigation");
});

test("contributes a status filter setting with supported display statuses", () => {
  const manifest = readManifest();
  const statusFilter = manifest.contributes.configuration.properties["codexRadar.statusFilter"];

  assert.equal(statusFilter.default, "all");
  assert.deepEqual(statusFilter.enum, [
    "all",
    "active",
    "running",
    "tool_running",
    "waiting_approval",
    "done",
    "stale",
    "unknown",
  ]);
});
