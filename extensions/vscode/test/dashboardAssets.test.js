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

test("keeps sidebar spacing compact and project groups visually separated", () => {
  const css = readDashboardCss();

  assert.match(css, /\.sidebar \.list\s*\{[^}]*padding:\s*0;/s);
  assert.match(css, /\.sidebar \.session\s*\{[^}]*padding:\s*5px 3px 5px 2px;/s);
  assert.match(css, /\.sidebar \.session\.actionable\s*\{[^}]*border-color:\s*transparent;/s);
  assert.match(css, /\.sidebar \.project\s*\{[^}]*border-top:\s*1px solid var\(--vscode-panel-border\);/s);
  assert.match(css, /\.sidebar \.project \.session\s*\{[^}]*margin-left:\s*10px;/s);
  assert.match(css, /\.sidebar \.project \.session\s*\{[^}]*border-left:/s);
});

test("keeps preview content aligned with narrower editor gutters", () => {
  const css = readDashboardCss();
  const js = fs.readFileSync(path.join(__dirname, "..", "src", "extension.js"), "utf8");

  assert.match(css, /\.preview-header\s*\{[^}]*padding:\s*10px 8px 10px;/s);
  assert.match(css, /\.preview-title-block\s*\{[^}]*max-width:\s*1120px;/s);
  assert.match(css, /\.preview-title-block\s*\{[^}]*margin:\s*0;/s);
  assert.match(css, /\.preview-transcript\s*\{[^}]*padding:\s*10px 8px 24px;/s);
  assert.doesNotMatch(css, /\.preview-summary/);
  assert.doesNotMatch(js, /preview-summary/);
});
