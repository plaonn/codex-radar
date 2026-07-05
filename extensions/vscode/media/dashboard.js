const vscode = acquireVsCodeApi();

let state = {
  error: "",
  model: null,
  surface: "dashboard",
};

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

function selectedKey() {
  return state.model?.selected?.key || "";
}

function actionButton(label, action, session, className = "ghost") {
  return button(label, className, (event) => {
    event.stopPropagation();
    send({ type: "sessionAction", action, key: session.key });
  });
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
  if (session.actions.canHide) {
    actions.appendChild(actionButton("Hide", "hide", session));
  }
  if (session.actions.canRestore) {
    actions.appendChild(actionButton("Restore", "restore", session));
  }
  return actions;
}

function sessionNode(session, options = {}) {
  const isActive = session.key && session.key === selectedKey();
  const readClass = session.isUnreadDone ? " unread" : session.isDoneRead ? " read" : "";
  const staleClass = session.isStale ? " stale" : "";
  const node = el("div", {
    className: `session status-${session.status}${readClass}${staleClass}${isActive ? " active" : ""}${options.showActions ? " actionable" : ""}`,
  });
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.addEventListener("click", () => {
    send({ type: "selectSession", key: session.key });
  });
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      send({ type: "selectSession", key: session.key });
    }
  });
  node.appendChild(statusIndicator(session));
  const text = el("span");
  text.appendChild(el("span", { className: "title", text: session.title }));
  if (session.snippet) {
    text.appendChild(el("span", { className: "snippet", text: session.snippet }));
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

function attentionPane(model) {
  const pane = el("section", { className: "pane" });
  pane.appendChild(el("div", { className: "pane-header" }, [
    el("span", { className: "pane-title", text: "Attention" }),
    el("span", { className: "count", text: String(model.counts.attention) }),
  ]));
  pane.appendChild(sessionList(model.attention, "No attention sessions"));
  if (model.hidden.length) {
    pane.appendChild(el("div", { className: "section-divider" }, [
      el("span", { className: "pane-title", text: "Hidden" }),
      el("span", { className: "count", text: String(model.counts.hidden) }),
    ]));
    pane.appendChild(sessionList(model.hidden, ""));
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
    const project = el("section", { className: "project" });
    project.appendChild(el("div", { className: "project-header" }, [
      el("span", { text: group.project }),
      el("span", { text: group.attention ? `${group.attention} attention / ${group.total}` : String(group.total) }),
    ]));
    for (const session of group.sessions) {
      project.appendChild(sessionNode(session));
    }
    body.appendChild(project);
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
    session.isAttention ? el("span", { className: "tag", text: "Attention" }) : null,
    session.isHidden ? el("span", { className: "tag", text: "Hidden" }) : null,
    session.isStale ? el("span", { className: "tag", text: "Stale" }) : null,
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
  if (session.actions.canHide) {
    actions.appendChild(button("Hide", "ghost", () => {
      send({ type: "sessionAction", action: "hide", key: session.key });
    }));
  }
  if (session.actions.canRestore) {
    actions.appendChild(button("Restore", "ghost", () => {
      send({ type: "sessionAction", action: "restore", key: session.key });
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
      el("span", { text: `${model.counts.attention} attention / ${model.counts.visible} visible` }),
    ]),
    el("div", { className: "toolbar" }, [
      select,
      button("Refresh", "secondary", () => send({ type: "refresh" })),
    ]),
  ]);
}

function sidebarTopbar(model, title, countText) {
  return el("header", { className: "topbar compact" }, [
    el("div", { className: "brand" }, [
      el("strong", { text: title }),
      el("span", { text: countText }),
    ]),
  ]);
}

function sidebarAttention(model) {
  const root = el("div", { className: "app sidebar" });
  root.appendChild(sidebarTopbar(model, "Attention", String(model.counts.attention)));
  root.appendChild(sessionList(model.attention, "No attention sessions", { showActions: true }));
  return root;
}

function sidebarProjects(model) {
  const root = el("div", { className: "app sidebar" });
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
  root.appendChild(el("header", { className: "topbar compact" }, [
    el("div", { className: "brand" }, [
      el("strong", { text: "Projects" }),
      el("span", { text: `${model.counts.filtered}/${model.counts.visible}` }),
    ]),
    el("div", { className: "toolbar" }, [
      select,
    ]),
  ]));
  const body = el("div", { className: "list" });
  if (!model.groups.length) {
    body.appendChild(el("div", { className: "empty", text: model.emptyState || "No sessions match this filter" }));
  }
  for (const group of model.groups) {
    const project = el("section", { className: "project" });
    project.appendChild(el("div", { className: "project-header" }, [
      el("span", { text: group.project }),
      el("span", { text: group.attention ? `${group.attention} attention / ${group.total}` : String(group.total) }),
    ]));
    for (const session of group.sessions) {
      project.appendChild(sessionNode(session, { showActions: true }));
    }
    body.appendChild(project);
  }
  root.appendChild(body);
  return root;
}

function sidebarHidden(model) {
  const root = el("div", { className: "app sidebar" });
  root.appendChild(sidebarTopbar(model, "Hidden", String(model.counts.hidden)));
  root.appendChild(sessionList(model.hidden, "No hidden sessions", { showActions: true }));
  return root;
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
  clear(app);
  if (state.error) {
    app.appendChild(el("div", { className: "error", text: state.error }));
  }
  if (!state.model) {
    app.appendChild(el("div", { className: "empty", text: "Loading Codex Radar sessions" }));
    return;
  }

  if (state.surface === "attention") {
    app.appendChild(sidebarAttention(state.model));
  } else if (state.surface === "projects") {
    app.appendChild(sidebarProjects(state.model));
  } else if (state.surface === "hidden") {
    app.appendChild(sidebarHidden(state.model));
  } else {
    app.appendChild(dashboardView(state.model));
  }
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

send({ type: "ready" });
render();
