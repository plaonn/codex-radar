const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function readDashboardCss() {
  return fs.readFileSync(path.join(__dirname, "..", "media", "dashboard.css"), "utf8");
}

function readDashboardJs() {
  return fs.readFileSync(path.join(__dirname, "..", "media", "dashboard.js"), "utf8");
}

test("scopes status colors to status indicators instead of session rows", () => {
  const css = readDashboardCss();

  assert.match(css, /\.status-dot\.status-waiting_approval\s*\{/);
  assert.match(css, /\.status-dot\.status-done\s*\{/);
  assert.match(css, /\.status-dot\.status-done\.unread\s*\{/);
  assert.match(css, /\.status-dot\.status-done\.read\s*\{/);
  assert.doesNotMatch(css, /^\.status-(?:waiting_approval|done)(?:[.\s{])/m);
});

test("keeps sidebar bodies free of duplicate section title bars", () => {
  const js = readDashboardJs();
  const css = readDashboardCss();

  assert.doesNotMatch(js, /sidebarTopbar/);
  assert.doesNotMatch(js, /topbar compact/);
  assert.doesNotMatch(css, /\.topbar\.compact/);
});

test("supports session-specific context menu and project folding", () => {
  const js = readDashboardJs();
  const css = readDashboardCss();

  assert.match(js, /Copy Session ID/);
  assert.match(js, /preventDefaultContextMenuItems/);
  assert.match(js, /collapsedProjects/);
  assert.match(css, /\.context-menu\s*\{/);
  assert.match(css, /\.project-header\.collapsible/);
});
