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

function readPreviewJs() {
  return fs.readFileSync(path.join(__dirname, "..", "media", "preview.js"), "utf8");
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

  assert.match(css, /\.sidebar \.list\s*\{[^}]*padding:\s*4px 6px 8px;/s);
  assert.match(css, /\.sidebar \.session\s*\{[^}]*padding:\s*6px;/s);
  assert.match(css, /\.sidebar \.session\s*\{[^}]*position:\s*relative;/s);
  assert.match(css, /\.sidebar \.session\.actionable\s*\{[^}]*border-color:\s*transparent;/s);
  assert.match(css, /\.sidebar \.project\s*\{[^}]*border-top:\s*1px solid var\(--vscode-panel-border\);/s);
  assert.match(css, /\.sidebar \.project \.session\s*\{[^}]*margin-left:\s*8px;/s);
  assert.match(css, /\.sidebar \.project \.session\s*\{[^}]*border-left:/s);
});

test("reveals sidebar row actions as hover and focus overlays", () => {
  const css = readDashboardCss();

  assert.match(css, /\.sidebar \.row-actions\.compact\s*\{[^}]*position:\s*absolute;/s);
  assert.match(css, /\.sidebar \.row-actions\.compact\s*\{[^}]*opacity:\s*0;/s);
  assert.match(css, /\.sidebar \.row-actions\.compact\s*\{[^}]*pointer-events:\s*none;/s);
  assert.match(css, /\.sidebar \.session:hover \.row-actions\.compact,\s*\.sidebar \.session:focus-within \.row-actions\.compact\s*\{[^}]*opacity:\s*1;/s);
  assert.match(css, /\.sidebar \.session:hover \.row-actions\.compact,\s*\.sidebar \.session:focus-within \.row-actions\.compact\s*\{[^}]*pointer-events:\s*auto;/s);
});

test("renders speaker snippets with compact text badges", () => {
  const js = readDashboardJs();
  const css = readDashboardCss();

  assert.match(js, /function snippetNode\(session\)/);
  assert.match(js, /snippetSpeaker/);
  assert.match(js, /snippet-text/);
  assert.match(css, /\.snippet-speaker\s*\{/);
  assert.match(css, /\.snippet-speaker\.speaker-user\s*\{/);
  assert.match(css, /\.snippet-text\s*\{/);
});

test("updates sidebar rows with keyed patching instead of full rebuilds", () => {
  const js = readDashboardJs();

  assert.match(js, /function sessionDomKey\(session\)/);
  assert.match(js, /node\.dataset\.sessionKey = sessionDomKey\(session\);/);
  assert.match(js, /function patchSessionList\(container, sessions, emptyText, options = \{\}\)/);
  assert.match(js, /const existing = new Map\(\);[\s\S]*existing\.set\(child\.dataset\.sessionKey, child\);/);
  assert.match(js, /if \(current !== node\) \{[\s\S]*container\.insertBefore\(node, current\);[\s\S]*\}/);
  assert.match(js, /function renderSidebar\(app, model, surface\)/);
  assert.match(js, /if \(state\.error \|\| !state\.model\) \{[\s\S]*return;[\s\S]*\}/);
  assert.match(js, /if \(isSidebarSurface\(state\.surface\)\) \{[\s\S]*renderSidebar\(app, state\.model, state\.surface\);[\s\S]*return;/);
  assert.doesNotMatch(js, /app\.appendChild\(sidebar(?:Attention|Projects|Archived)\(/);
});

test("keeps preview content aligned with narrower editor gutters", () => {
  const css = readDashboardCss();
  const js = fs.readFileSync(path.join(__dirname, "..", "src", "extension.js"), "utf8");

  assert.match(css, /\.preview-header\s*\{[^}]*padding:\s*16px 16px 12px;/s);
  assert.match(css, /\.preview-title-block\s*\{[^}]*max-width:\s*1120px;/s);
  assert.match(css, /\.preview-title-block\s*\{[^}]*margin:\s*0;/s);
  assert.match(css, /\.preview-transcript\s*\{[^}]*padding:\s*14px 16px 24px;/s);
  assert.doesNotMatch(css, /\.preview-summary/);
  assert.doesNotMatch(js, /preview-summary/);
});

test("uses a fixed preview header and scrollable transcript body", () => {
  const css = readDashboardCss();
  const extension = fs.readFileSync(path.join(__dirname, "..", "src", "extension.js"), "utf8");
  const preview = readPreviewJs();

  assert.match(css, /\.preview\s*\{[^}]*height:\s*100vh;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.preview-header\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(css, /\.preview-body\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(extension, /<section class="preview-body" aria-label="Transcript preview">/);
  assert.match(extension, /media", "preview\.js"/);
  assert.match(extension, /enableScripts:\s*true/);
  assert.doesNotMatch(extension, /webview\.html = previewHtml\(this\.previewPanel\.webview, this\.context\.extensionUri, model/);
  assert.match(extension, /this\.previewPanel\.webview\.postMessage\(this\.pendingPreviewState\)/);
  assert.match(extension, /session\.session_id \|\| session\.sessionId \|\| session\.key/);
  assert.match(preview, /acquireVsCodeApi\(\)/);
  assert.match(preview, /message\.initialScrollToBottom \|\| isNewSession \|\| isNearBottom\(\)/);
  assert.match(preview, /addEventListener\("scroll", saveScroll/);
  assert.match(preview, /vscode\.postMessage\(\{ type:\s*"previewReady" \}\)/);
});

test("keeps preview ownership independent from dashboard selection fallback", () => {
  const extension = fs.readFileSync(path.join(__dirname, "..", "src", "extension.js"), "utf8");

  assert.match(extension, /function previewSessionIdentity\(session\)/);
  assert.match(extension, /session\.session_id \|\| session\.sessionId \|\| session\.key/);
  assert.match(extension, /sessionForPreviewIdentity\(identity\)/);
  assert.match(extension, /const session = this\.sessionForPreviewIdentity\(this\.previewSessionKey\);/);
  assert.doesNotMatch(
    extension,
    /updatePreviewPanel\(\)\s*\{[\s\S]*?this\.sessionForKey\(this\.selectedKey\)/,
  );
  assert.match(extension, /const requestedKey = String\(message\.key \|\| ""\);/);
  assert.match(extension, /const requestedSession = this\.sessionForKey\(requestedKey\);/);
  assert.match(extension, /const requestedIdentity = previewSessionIdentity\(requestedSession\);/);
  assert.match(
    extension,
    /this\.sessionForPreviewIdentity\(requestedIdentity\) \|\| this\.sessionForKey\(requestedKey\) \|\| requestedSession/,
  );
});

test("tracks selected rows by stable session identity across refreshes", () => {
  const extension = fs.readFileSync(path.join(__dirname, "..", "src", "extension.js"), "utf8");

  assert.match(extension, /this\.selectedSessionIdentity = "";/);
  assert.match(extension, /selectedIdentity: this\.selectedSessionIdentity/);
  assert.match(extension, /this\.selectedSessionIdentity = previewSessionIdentity\(this\.model\.selected\);/);
  assert.match(extension, /this\.selectedSessionIdentity = previewSessionIdentity\(session\);/);
  assert.match(extension, /this\.selectedSessionIdentity = requestedIdentity;/);
});
