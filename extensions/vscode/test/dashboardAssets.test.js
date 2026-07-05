const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function readDashboardCss() {
  return fs.readFileSync(path.join(__dirname, "..", "media", "dashboard.css"), "utf8");
}

test("scopes status colors to status indicators instead of session rows", () => {
  const css = readDashboardCss();

  assert.match(css, /\.status-dot\.status-waiting_approval\s*\{/);
  assert.match(css, /\.status-dot\.status-done\s*\{/);
  assert.match(css, /\.status-dot\.status-done\.unread\s*\{/);
  assert.match(css, /\.status-dot\.status-done\.read\s*\{/);
  assert.doesNotMatch(css, /^\.status-(?:waiting_approval|done)(?:[.\s{])/m);
});
