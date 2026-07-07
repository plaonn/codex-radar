const vscode = acquireVsCodeApi();
const persistedUiState = vscode.getState() || {};

let state = {
  error: "",
  model: null,
  surface: "dashboard",
};
let collapsedProjects = persistedUiState.collapsedProjects || {};
let contextMenuNode = null;

function send(message) {
  vscode.postMessage(message);
}

function clear(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function el(tagName, options = {}, children = []) {
  const node = document.createElement(tagName);
  if (options.className) {
    node.className = options.className;
  }
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  if (options.title) {
    node.title = options.title;
  }
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      node.dataset[key] = String(value);
    }
  }
  for (const child of children) {
    if (child) {
      node.appendChild(child);
    }
  }
  return node;
}

function button(label, className, onClick, disabled = false) {
  const node = el("button", { className, text: label });
  node.disabled = disabled;
  node.addEventListener("click", onClick);
  return node;
}

function persistUiState() {
  vscode.setState({ collapsedProjects });
}

function selectedKey() {
  return state.model?.selected?.key || "";
}

function sessionDomKey(session) {
  return String(session.key || session.sessionId || session.shortSessionId || "");
}

function actionButton(label, action, session, className = "ghost") {
  return button(label, className, (event) => {
    event.stopPropagation();
    send({ type: "sessionAction", action, key: session.key });
  });
}

function closeContextMenu() {
  if (contextMenuNode) {
    contextMenuNode.remove();
    contextMenuNode = null;
  }
}

function showSessionContextMenu(event, session) {
  event.preventDefault();
  event.stopPropagation();
  closeContextMenu();

  const menu = el("div", { className: "context-menu" }, [
    button("Copy Session ID", "", () => {
      send({ type: "copySessionId", sessionId: session.sessionId });
      closeContextMenu();
    }),
  ]);
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const left = Math.min(event.clientX, window.innerWidth - rect.width - 4);
  const top = Math.min(event.clientY, window.innerHeight - rect.height - 4);
  menu.style.left = `${Math.max(4, left)}px`;
  menu.style.top = `${Math.max(4, top)}px`;
  contextMenuNode = menu;
}

function sessionClassName(session, options = {}) {
  const isActive = session.key && session.key === selectedKey();
  const readClass = session.isUnreadDone ? " unread" : session.isDoneRead ? " read" : "";
  const archivedClass = session.isArchived ? " archived" : "";
  return `session status-${session.status}${readClass}${archivedClass}${isActive ? " active" : ""}${options.showActions ? " actionable" : ""}`;
}

function sessionActions(session, options = {}) {
  const actions = el("div", { className: options.compact ? "row-actions compact" : "row-actions" });
  if (session.actions.canOpen) {
    actions.appendChild(actionButton("Open", "open", session, ""));
  }
  if (session.actions.canMarkRead) {
    actions.appendChild(actionButton("Read", "markRead", session, "secondary"));
  }
  if (session.actions.canMarkUnread) {
    actions.appendChild(actionButton("Unread", "markUnread", session, "secondary"));
  }
  return actions;
}

function snippetNode(session) {
  const text = String(session.snippetText || session.snippet || "");
  if (!text) {
    return null;
  }
  const children = [];
  if (session.snippetSpeaker) {
    children.push(el("span", { className: `snippet-speaker speaker-${session.snippetRole || ""}`, text: session.snippetSpeaker }));
  }
  children.push(el("span", { className: "snippet-text", text }));
  return el("span", { className: "snippet" }, children);
}

function sessionNode(session, options = {}) {
  const node = el("div", {
    dataset: {
      vscodeContext: JSON.stringify({ preventDefaultContextMenuItems: true }),
    },
  });
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.addEventListener("click", () => {
    send({ type: "selectSession", key: node.dataset.sessionKey || "" });
  });
  node.addEventListener("dblclick", () => {
    if (node.codexRadarSession?.actions?.canOpen) {
      send({ type: "sessionAction", action: "open", key: node.dataset.sessionKey || "" });
    }
  });
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      send({ type: "selectSession", key: node.dataset.sessionKey || "" });
    }
  });
  node.addEventListener("contextmenu", (event) => {
    showSessionContextMenu(event, node.codexRadarSession || {});
  });
  updateSessionNode(node, session, options);
  return node;
}

function sessionRenderSignature(session, options = {}) {
  return JSON.stringify({
    key: sessionDomKey(session),
    className: sessionClassName(session, options),
    status: session.status,
    statusText: session.statusText,
    isUnreadDone: session.isUnreadDone,
    isDoneRead: session.isDoneRead,
    title: session.title,
    snippet: session.snippetText || session.snippet || "",
    snippetSpeaker: session.snippetSpeaker || "",
    snippetRole: session.snippetRole || "",
    meta: session.description || session.statusText,
    showActions: Boolean(options.showActions),
    canOpen: Boolean(session.actions?.canOpen),
    canMarkRead: Boolean(session.actions?.canMarkRead),
    canMarkUnread: Boolean(session.actions?.canMarkUnread),
  });
}

function updateSessionNode(node, session, options = {}) {
  const signature = sessionRenderSignature(session, options);
  node.codexRadarSession = session;
  node.dataset.sessionKey = sessionDomKey(session);
  if (node.dataset.renderSignature === signature) {
    return node;
  }
  node.dataset.renderSignature = signature;
  node.className = sessionClassName(session, options);
  clear(node);
  node.appendChild(statusIndicator(session));
  const text = el("span");
  text.appendChild(el("span", { className: "title", text: session.title }));
  const snippet = snippetNode(session);
  if (snippet) {
    text.appendChild(snippet);
  }
  text.appendChild(el("span", { className: "meta", text: session.description || session.statusText }));
  if (options.showActions) {
    text.appendChild(sessionActions(session, { compact: true }));
  }
  node.appendChild(text);
  return node;
}

function statusIndicator(session) {
  if (session.status === "running" || session.status === "tool_running") {
    return el("span", { className: "status-spinner", title: session.statusText });
  }
  if (session.status === "unknown") {
    return el("span", { className: "status-alert", text: "!", title: "Unknown status" });
  }
  const readClass = session.isUnreadDone ? " unread" : session.isDoneRead ? " read" : "";
  return el("span", { className: `status-dot status-${session.status}${readClass}`, title: session.statusText });
}

function sessionList(sessions, emptyText, options = {}) {
  const list = el("div", { className: "list" });
  if (!sessions.length) {
    list.appendChild(el("div", { className: "empty", text: emptyText }));
    return list;
  }
  for (const session of sessions) {
    list.appendChild(sessionNode(session, options));
  }
  return list;
}

function patchSessionList(container, sessions, emptyText, options = {}) {
  const existing = new Map();
  for (const child of Array.from(container.children)) {
    if (child.classList.contains("session") && child.dataset.sessionKey) {
      existing.set(child.dataset.sessionKey, child);
    }
  }

  if (!sessions.length) {
    if (container.children.length !== 1 || !container.firstElementChild?.classList.contains("empty")) {
      clear(container);
      container.appendChild(el("div", { className: "empty", text: emptyText }));
    } else {
      container.firstElementChild.textContent = emptyText;
    }
    return;
  }

  const wanted = new Set();
  sessions.forEach((session, index) => {
    const key = sessionDomKey(session);
    wanted.add(key);
    const node = existing.get(key) || sessionNode(session, options);
    updateSessionNode(node, session, options);
    const current = container.children[index] || null;
    if (current !== node) {
      container.insertBefore(node, current);
    }
  });

  for (const child of Array.from(container.children)) {
    if (!child.classList.contains("session") || !wanted.has(child.dataset.sessionKey)) {
      child.remove();
    }
  }
}

function projectStorageKey(group) {
  return String(group.project || "-");
}

function isProjectCollapsed(group, options = {}) {
  const key = projectStorageKey(group);
  if (Object.prototype.hasOwnProperty.call(collapsedProjects, key)) {
    return Boolean(collapsedProjects[key]);
  }
  if (state.model?.statusFilter) {
    return false;
  }
  if (group.sessions.some((session) => session.key && session.key === selectedKey())) {
    return false;
  }
  if (group.isCurrentWorkspace) {
    return false;
  }
  return Boolean(options.defaultCollapseQuiet && group.attention === 0);
}

function projectGroupNode(group, options = {}) {
  const collapsed = options.collapsible ? isProjectCollapsed(group, options) : false;
  const project = el("section", { className: `project${collapsed ? " collapsed" : ""}` });
  const label = group.attention ? `${group.attention} review / ${group.total}` : String(group.total);
  const headerChildren = [];
  if (options.collapsible) {
    headerChildren.push(el("span", { className: `chevron ${collapsed ? "collapsed" : "expanded"}` }));
  }
  if (group.isCurrentWorkspace) {
    headerChildren.push(el("span", { className: "workspace-label", text: "Current Workspace" }));
  }
  headerChildren.push(el("span", { className: "project-main" }, [
    el("span", { className: "project-name", text: group.project }),
    el("span", { className: "project-count", text: label }),
  ]));

  const header = el(options.collapsible ? "button" : "div", {
    className: `${options.collapsible ? "project-header collapsible" : "project-header"}${group.isCurrentWorkspace ? " current-workspace" : ""}`,
  }, headerChildren);
  if (options.collapsible) {
    header.setAttribute("aria-expanded", collapsed ? "false" : "true");
    header.addEventListener("click", () => {
      collapsedProjects = {
        ...collapsedProjects,
        [projectStorageKey(group)]: !collapsed,
      };
      persistUiState();
      render();
    });
  }
  project.appendChild(header);
  if (!collapsed) {
    for (const session of group.sessions) {
      project.appendChild(sessionNode(session, { showActions: options.showActions }));
    }
  }
  return project;
}

function attentionPane(model) {
  const pane = el("section", { className: "pane" });
  pane.appendChild(el("div", { className: "pane-header" }, [
    el("span", { className: "pane-title", text: "Attention" }),
    el("span", { className: "count", text: String(model.counts.attention) }),
  ]));
  pane.appendChild(sessionList(model.attention, "No sessions need review"));
  if (model.archived.length) {
    pane.appendChild(el("div", { className: "section-divider" }, [
      el("span", { className: "pane-title", text: "Archived" }),
      el("span", { className: "count", text: String(model.counts.archived) }),
    ]));
    pane.appendChild(sessionList(model.archived, ""));
  }
  return pane;
}

function projectsPane(model) {
  const pane = el("section", { className: "pane" });
  pane.appendChild(el("div", { className: "pane-header" }, [
    el("span", { className: "pane-title", text: "Projects" }),
    el("span", { className: "count", text: `${model.counts.filtered}/${model.counts.visible}` }),
  ]));
  const body = el("div", { className: "list" });
  if (!model.groups.length) {
    body.appendChild(el("div", { className: "empty", text: model.emptyState || "No sessions match this filter" }));
  }
  for (const group of model.groups) {
    body.appendChild(projectGroupNode(group));
  }
  pane.appendChild(body);
  return pane;
}

function detailRow(label, value) {
  if (!value) {
    return [];
  }
  return [el("dt", { text: label }), el("dd", { text: value })];
}

function inspectorPane(model) {
  const pane = el("section", { className: "pane" });
  pane.appendChild(el("div", { className: "pane-header" }, [
    el("span", { className: "pane-title", text: "Session" }),
    el("span", { className: "count", text: model.selected?.statusText || "" }),
  ]));

  if (!model.selected) {
    pane.appendChild(el("div", { className: "empty", text: "No session selected" }));
    return pane;
  }

  const session = model.selected;
  const body = el("div", { className: "inspector" });
  body.appendChild(el("h2", { text: session.title }));
  if (session.snippet) {
    body.appendChild(el("div", { className: "snippet", text: session.snippet }));
  }
  body.appendChild(el("div", { className: "tag-row" }, [
    el("span", { className: "tag", text: session.statusText }),
    session.isAttention ? el("span", { className: "tag", text: "Needs review" }) : null,
    session.isArchived ? el("span", { className: "tag", text: "Archived" }) : null,
    session.isUnreadDone ? el("span", { className: "tag", text: "Unread" }) : null,
  ]));

  const details = el("dl", { className: "details" });
  for (const node of [
    ...detailRow("Project", session.project),
    ...detailRow("Last seen", session.relativeLastSeen || session.lastSeenAt),
    ...detailRow("Last event", session.lastEventName),
    ...detailRow("Model", session.model),
    ...detailRow("Tool", session.currentTool),
    ...detailRow("Session", session.shortSessionId),
  ]) {
    details.appendChild(node);
  }
  body.appendChild(details);

  const actions = el("div", { className: "actions" });
  actions.appendChild(button("Open in Codex", "", () => {
    send({ type: "sessionAction", action: "open", key: session.key });
  }, !session.actions.canOpen));
  if (session.actions.canMarkRead) {
    actions.appendChild(button("Mark read", "secondary", () => {
      send({ type: "sessionAction", action: "markRead", key: session.key });
    }));
  }
  if (session.actions.canMarkUnread) {
    actions.appendChild(button("Mark unread", "secondary", () => {
      send({ type: "sessionAction", action: "markUnread", key: session.key });
    }));
  }
  body.appendChild(actions);
  pane.appendChild(body);
  return pane;
}

function topbar(model) {
  const select = el("select");
  for (const option of model.statusOptions) {
    const child = el("option", { text: option.label });
    child.value = option.value;
    child.selected = option.isSelected;
    select.appendChild(child);
  }
  select.addEventListener("change", () => {
    send({ type: "setStatusFilter", value: select.value });
  });

  return el("header", { className: "topbar" }, [
    el("div", { className: "brand" }, [
      el("strong", { text: "Codex Radar" }),
      el("span", { text: `${model.counts.attention} review / ${model.counts.visible} active` }),
    ]),
    el("div", { className: "toolbar" }, [
      select,
      button("Refresh", "secondary", () => send({ type: "refresh" })),
    ]),
  ]);
}

function isSidebarSurface(surface) {
  return surface === "attention" || surface === "projects" || surface === "archived";
}

function sidebarRoot(app, surface) {
  if (app.dataset.renderMode !== "sidebar" || app.dataset.surface !== surface) {
    clear(app);
    app.dataset.renderMode = "sidebar";
    app.dataset.surface = surface;
    app.appendChild(el("div", { className: "app sidebar" }));
  }
  return app.firstElementChild;
}

function sidebarListRoot(root) {
  let list = root.firstElementChild;
  if (!list || !list.classList.contains("list")) {
    clear(root);
    list = el("div", { className: "list" });
    root.appendChild(list);
  }
  return list;
}

function projectHeaderNode(project) {
  let header = project.firstElementChild;
  if (!header || !header.classList.contains("project-header")) {
    clear(project);
    header = el("button", { className: "project-header collapsible" }, [
      el("span", { className: "chevron" }),
      el("span", { className: "project-main" }, [
        el("span", { className: "project-name" }),
        el("span", { className: "project-count" }),
      ]),
    ]);
    header.addEventListener("click", () => {
      const key = project.dataset.projectKey || "-";
      collapsedProjects = {
        ...collapsedProjects,
        [key]: !project.classList.contains("collapsed"),
      };
      persistUiState();
      render();
    });
    project.appendChild(header);
  }
  return header;
}

function updateProjectHeader(project, group, collapsed) {
  const header = projectHeaderNode(project);
  const label = group.attention ? `${group.attention} review / ${group.total}` : String(group.total);
  header.className = `project-header collapsible${group.isCurrentWorkspace ? " current-workspace" : ""}`;
  header.setAttribute("aria-expanded", collapsed ? "false" : "true");
  header.querySelector(".chevron").className = `chevron ${collapsed ? "collapsed" : "expanded"}`;
  let workspaceLabel = header.querySelector(".workspace-label");
  if (group.isCurrentWorkspace && !workspaceLabel) {
    workspaceLabel = el("span", { className: "workspace-label", text: "Current Workspace" });
    const projectMain = header.querySelector(".project-main");
    header.insertBefore(workspaceLabel, projectMain);
  } else if (!group.isCurrentWorkspace && workspaceLabel) {
    workspaceLabel.remove();
  }
  header.querySelector(".project-name").textContent = group.project;
  header.querySelector(".project-count").textContent = label;
}

function projectSessionsNode(project) {
  let sessions = project.querySelector(".project-sessions");
  if (!sessions) {
    sessions = el("div", { className: "project-sessions" });
    project.appendChild(sessions);
  }
  return sessions;
}

function sidebarProjectNode(group) {
  const project = el("section", {
    className: "project",
    dataset: { projectKey: projectStorageKey(group) },
  });
  projectHeaderNode(project);
  project.appendChild(el("div", { className: "project-sessions" }));
  return project;
}

function updateSidebarProjectNode(project, group, options = {}) {
  const collapsed = options.collapsible ? isProjectCollapsed(group, options) : false;
  project.dataset.projectKey = projectStorageKey(group);
  project.className = `project${collapsed ? " collapsed" : ""}`;
  updateProjectHeader(project, group, collapsed);
  const sessions = projectSessionsNode(project);
  if (collapsed) {
    clear(sessions);
  } else {
    patchSessionList(sessions, group.sessions, "", { showActions: options.showActions });
  }
}

function patchProjectGroups(container, groups, emptyText, options = {}) {
  const existing = new Map();
  for (const child of Array.from(container.children)) {
    if (child.classList.contains("project") && child.dataset.projectKey) {
      existing.set(child.dataset.projectKey, child);
    }
  }

  if (!groups.length) {
    if (container.children.length !== 1 || !container.firstElementChild?.classList.contains("empty")) {
      clear(container);
      container.appendChild(el("div", { className: "empty", text: emptyText }));
    } else {
      container.firstElementChild.textContent = emptyText;
    }
    return;
  }

  const wanted = new Set();
  groups.forEach((group, index) => {
    const key = projectStorageKey(group);
    wanted.add(key);
    const project = existing.get(key) || sidebarProjectNode(group);
    updateSidebarProjectNode(project, group, options);
    const current = container.children[index] || null;
    if (current !== project) {
      container.insertBefore(project, current);
    }
  });

  for (const child of Array.from(container.children)) {
    if (!child.classList.contains("project") || !wanted.has(child.dataset.projectKey)) {
      child.remove();
    }
  }
}

function renderSidebar(app, model, surface) {
  const root = sidebarRoot(app, surface);
  const list = sidebarListRoot(root);
  if (surface === "attention") {
    patchSessionList(list, model.attention, "No sessions need review", { showActions: true });
  } else if (surface === "archived") {
    patchSessionList(list, model.archived, "No archived sessions", { showActions: true });
  } else {
    patchProjectGroups(list, model.sidebarGroups || model.groups, model.emptyState || "No sessions match this filter", {
      collapsible: true,
      defaultCollapseQuiet: true,
      showActions: true,
    });
  }
}

function dashboardView(model) {
  const root = el("div", { className: "app" });
  root.appendChild(topbar(model));
  root.appendChild(el("div", { className: "layout" }, [
    attentionPane(model),
    projectsPane(model),
    inspectorPane(model),
  ]));
  return root;
}

function render() {
  const app = document.getElementById("app");
  if (state.error || !state.model) {
    clear(app);
    app.dataset.renderMode = "full";
    app.dataset.surface = state.surface || "";
    if (state.error) {
      app.appendChild(el("div", { className: "error", text: state.error }));
    }
    if (!state.model) {
      app.appendChild(el("div", { className: "empty", text: "Loading Codex Radar sessions" }));
    }
    return;
  }

  if (isSidebarSurface(state.surface)) {
    renderSidebar(app, state.model, state.surface);
    return;
  }

  clear(app);
  app.dataset.renderMode = "full";
  app.dataset.surface = state.surface || "";
  app.appendChild(dashboardView(state.model));
}

window.addEventListener("message", (event) => {
  if (event.data?.type === "state") {
    state = {
      error: event.data.error || "",
      model: event.data.model || null,
      surface: event.data.surface || "dashboard",
    };
    render();
  }
});

document.addEventListener("click", closeContextMenu);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeContextMenu();
  }
});
window.addEventListener("blur", closeContextMenu);

send({ type: "ready" });
render();
