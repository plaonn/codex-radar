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

function readExtensionJs() {
  return fs.readFileSync(path.join(__dirname, "..", "src", "extension.js"), "utf8");
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
  assert.match(js, /chevron \$\{collapsed \? "collapsed" : "expanded"\}/);
  assert.match(css, /\.context-menu\s*\{/);
  assert.match(css, /\.project-header\.collapsible/);
  assert.match(css, /\.chevron::before\s*\{/);
  assert.match(css, /\.chevron\.collapsed::before\s*\{[^}]*rotate\(-45deg\)/s);
  assert.match(css, /\.chevron\.expanded::before\s*\{[^}]*rotate\(45deg\)/s);
});

test("renders current workspace project groups as pinned sidebar headers", () => {
  const js = readDashboardJs();
  const css = readDashboardCss();
  const extension = readExtensionJs();

  assert.match(js, /model\.sidebarGroups \|\| model\.groups/);
  assert.match(js, /group\.isCurrentWorkspace/);
  assert.match(js, /Current Workspace/);
  assert.match(extension, /onDidChangeWorkspaceFolders\(\(\) => controller\.refresh\(\)\)/);
  assert.match(css, /\.sidebar \.project-header\.current-workspace\s*\{/);
  assert.match(css, /\.workspace-label\s*\{/);
});

test("keeps sidebar spacing compact and project groups visually separated", () => {
  const css = readDashboardCss();

  assert.match(css, /\.sidebar \.list\s*\{[^}]*padding:\s*4px 6px 8px;/s);
  assert.match(css, /\.sidebar \.session\s*\{[^}]*padding:\s*6px;/s);
  assert.match(css, /\.sidebar \.session\s*\{[^}]*position:\s*relative;/s);
  assert.match(css, /\.sidebar \.session\.actionable\s*\{[^}]*border-color:\s*transparent;/s);
  assert.match(css, /\.sidebar \.project\s*\{[^}]*margin:\s*1px 0;/s);
  assert.match(css, /\.sidebar \.project\s*\{[^}]*padding:\s*0;/s);
  assert.doesNotMatch(css, /\.sidebar \.project\s*\{[^}]*border-top:/s);
  assert.doesNotMatch(css, /\.sidebar \.project\.collapsed\s*\{/);
  assert.match(css, /\.sidebar \.project-header\s*\{[^}]*--vscode-sideBarSectionHeader-background/s);
  assert.match(css, /\.sidebar \.project-header\s*\{[^}]*border-left:\s*2px solid color-mix/s);
  assert.match(css, /\.sidebar \.project-header\.current-workspace\s*\{[^}]*padding-left:\s*4px;/s);
  assert.match(css, /\.sidebar \.project-header\.current-workspace\s*\{[^}]*border-left:\s*2px solid var\(--vscode-focusBorder\);/s);
  assert.match(css, /\.sidebar \.project-sessions\s*\{[^}]*margin-top:\s*2px;/s);
  assert.match(css, /\.sidebar \.project \.session\s*\{[^}]*width:\s*calc\(100% - 6px\);/s);
  assert.match(css, /\.sidebar \.project \.session\s*\{[^}]*margin-left:\s*6px;/s);
  assert.doesNotMatch(css, /\.sidebar \.project \.session\s*\{[^}]*border-left:/s);
});

test("reveals sidebar row actions as hover and focus overlays", () => {
  const css = readDashboardCss();

  assert.match(css, /\.sidebar \.row-actions\.compact\s*\{[^}]*position:\s*absolute;/s);
  assert.match(css, /\.sidebar \.row-actions\.compact\s*\{[^}]*opacity:\s*0;/s);
  assert.match(css, /\.sidebar \.row-actions\.compact\s*\{[^}]*visibility:\s*hidden;/s);
  assert.match(css, /\.sidebar \.row-actions\.compact\s*\{[^}]*visibility 0s linear 120ms;/s);
  assert.match(css, /\.sidebar \.session:hover \.row-actions\.compact,\s*\.sidebar \.session:focus-within \.row-actions\.compact\s*\{[^}]*opacity:\s*1;/s);
  assert.match(css, /\.sidebar \.session:hover \.row-actions\.compact,\s*\.sidebar \.session:focus-within \.row-actions\.compact\s*\{[^}]*visibility:\s*visible;/s);
  assert.match(css, /\.sidebar \.session:hover \.row-actions\.compact,\s*\.sidebar \.session:focus-within \.row-actions\.compact\s*\{[^}]*transition-delay:\s*0s;/s);
});

test("opens eligible sidebar sessions in Codex on double-click", () => {
  const js = readDashboardJs();

  assert.match(js, /addEventListener\("dblclick"/);
  assert.match(js, /deferClickSelection/);
  assert.match(js, /clearTimeout\(node\.codexRadarClickTimer\)/);
  assert.match(js, /codexRadarSession\?\.actions\?\.canOpen/);
  assert.match(js, /type:\s*"sessionAction", action:\s*"open"/);
});

test("routes workspace mismatches through a new-window handoff", () => {
  const extension = fs.readFileSync(path.join(__dirname, "..", "src", "extension.js"), "utf8");

  assert.match(extension, /openThreadBehavior/);
  assert.match(extension, /This Codex thread belongs to a different workspace/);
  assert.match(extension, /"vscode\.openFolder"/);
  assert.match(extension, /currentUri\.with\(\{ path: fsPath/);
  assert.match(extension, /forceNewWindow:\s*true/);
  assert.match(extension, /resumePendingWorkspaceHandoff/);
  assert.match(extension, /onDidChangeWindowState/);
  assert.match(extension, /state\.focused/);
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

test("renders setup diagnostics without replacing the session dashboard", () => {
  const js = readDashboardJs();
  const css = readDashboardCss();

  assert.match(js, /function setupNoticeNode\(setup\)/);
  assert.match(js, /model\.setup && \(!model\.groups\.length \|\| model\.setup\.code === "stale-session-index"\)/);
  assert.match(js, /Refresh after the next Codex turn to update this view\./);
  assert.match(css, /\.setup-notice\s*\{/);
  assert.match(css, /\.setup-notice\.severity-error\s*\{/);
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

test("constrains preview bubbles and wraps long content", () => {
  const css = readDashboardCss();

  assert.match(css, /\.preview-entry\s*\{[^}]*width:\s*fit-content;/s);
  assert.match(css, /\.preview-entry\s*\{[^}]*max-width:\s*min\(78%, 78ch\);/s);
  assert.match(css, /\.preview-bubble\s*\{[^}]*max-width:\s*100%;/s);
  assert.match(css, /\.preview-bubble\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(css, /\.preview-bubble\s*\{[^}]*word-break:\s*break-word;/s);
  assert.match(css, /\.preview-bubble pre\s*\{[^}]*max-width:\s*100%;/s);
  assert.match(css, /\.preview-transcript\s*\{[^}]*overflow-x:\s*hidden;/s);
});

test("uses a fixed preview header and scrollable transcript body", () => {
  const css = readDashboardCss();
  const extension = fs.readFileSync(path.join(__dirname, "..", "src", "extension.js"), "utf8");
  const preview = readPreviewJs();

  assert.match(css, /\.preview\s*\{[^}]*height:\s*100vh;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.preview-header\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(css, /\.preview-body\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(extension, /<section class="preview-body" aria-label="Transcript preview">/);
  assert.match(extension, /id="preview-open"/);
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

test("wires preview Open in Codex action through the preview Webview", () => {
  const preview = readPreviewJs();
  const extension = fs.readFileSync(path.join(__dirname, "..", "src", "extension.js"), "utf8");

  assert.match(preview, /function renderOpenAction\(message\)/);
  assert.match(preview, /button\.disabled = !canOpen;/);
  assert.match(preview, /type:\s*"sessionAction", action:\s*"open", key:\s*message\.key/);
  assert.match(extension, /actions:\s*card\.actions/);
  assert.match(extension, /key:\s*card\.key/);
  assert.match(extension, /handlePreviewMessage\(message\)/);
  assert.match(extension, /await this\.handleSessionAction\(String\(message\.key \|\| ""\), String\(message\.action \|\| ""\)\);/);
});

test("adds a Radar-native status bar item for attention and running counts", () => {
  const extension = fs.readFileSync(path.join(__dirname, "..", "src", "extension.js"), "utf8");

  assert.match(extension, /class RadarStatusBar/);
  assert.match(extension, /radarStatusText\(model\)/);
  assert.match(extension, /\$\(radar\).*review.*running.*active/s);
  assert.match(extension, /onModelChange:\s*\(model\) => radarStatusBar\.refresh\(model\)/);
  assert.match(extension, /item\.command = "codexRadar\.openDashboard"/);
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
