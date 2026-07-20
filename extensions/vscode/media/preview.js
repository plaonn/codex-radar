const vscode = typeof acquireVsCodeApi === "function"
  ? acquireVsCodeApi()
  : { postMessage() {} };

let activeSessionIdentity = "";

function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const node = byId(id);
  if (node) {
    node.textContent = value || "";
  }
}

function clear(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
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
  if (options.html !== undefined) {
    node.innerHTML = options.html;
  }
  for (const child of children) {
    if (child) {
      node.appendChild(child);
    }
  }
  return node;
}

function previewBody() {
  return document.querySelector(".preview-body");
}

function isNearBottom() {
  const body = previewBody();
  return body ? body.scrollHeight - body.scrollTop - body.clientHeight < 48 : false;
}

function saveScroll() {
  const body = previewBody();
  if (!body || !activeSessionIdentity) {
    return;
  }
  vscode.postMessage({
    type: "previewScroll",
    sessionIdentity: activeSessionIdentity,
    scrollTop: body.scrollTop,
    nearBottom: isNearBottom(),
  });
}

function scrollToBottom() {
  const body = previewBody();
  if (!body) {
    return;
  }
  body.scrollTop = body.scrollHeight;
  saveScroll();
}

function scrollToBottomAfterLayout() {
  requestAnimationFrame(scrollToBottom);
  requestAnimationFrame(() => requestAnimationFrame(scrollToBottom));
  setTimeout(scrollToBottom, 0);
  setTimeout(scrollToBottom, 50);
}

function renderDetails(model) {
  const details = byId("preview-details");
  if (!details) {
    return;
  }
  clear(details);
  for (const [label, value] of [
    ["Last seen", model.lastSeen],
    ["Last event", model.lastEvent],
    ["Model", model.model],
    ["Tool", model.currentTool],
  ]) {
    if (value) {
      details.appendChild(el("dt", { text: label }));
      details.appendChild(el("dd", { text: value }));
    }
  }
}

function renderOpenAction(message) {
  const button = byId("preview-open");
  if (!button) {
    return;
  }
  const canOpen = Boolean(message.actions?.canOpen);
  button.disabled = !canOpen;
  button.title = canOpen ? "Open this session in Codex" : "This session cannot be opened in Codex";
  button.onclick = () => {
    if (canOpen) {
      vscode.postMessage({
        type: "sessionAction",
        action: "open",
        sessionId: message.sessionId || "",
        key: message.key || "",
        interactionAt: typeof performance !== "undefined"
          ? performance.timeOrigin + performance.now()
          : Date.now(),
      });
    }
  };
}

function timestampParts(value) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return {
    dateKey: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
    dateText: date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
    timeText: date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }),
    accessibleText: date.toLocaleString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    }),
  };
}

function dateSeparator(parts) {
  const separator = el("div", { className: "preview-date-separator" }, [
    el("span", { text: parts.dateText }),
  ]);
  separator.setAttribute("role", "separator");
  separator.setAttribute("aria-label", parts.dateText);
  return separator;
}

function transcriptEntry(entry, timestamp) {
  const article = el("article", { className: `preview-entry ${entry.role || ""}` }, [
    el("div", { className: "preview-role", text: entry.label || entry.role || "" }),
    el("div", { className: "preview-bubble", html: entry.html || "" }),
  ]);
  if (timestamp) {
    const time = el("time", {
      className: "preview-time",
      text: timestamp.timeText,
    });
    time.dateTime = entry.recordedAt;
    time.title = timestamp.accessibleText;
    time.setAttribute("aria-label", `Recorded ${timestamp.accessibleText}`);
    article.appendChild(time);
  }
  return article;
}

function renderTranscript(model) {
  const transcript = byId("preview-transcript");
  if (!transcript) {
    return;
  }
  clear(transcript);

  if (model.transcriptMessage) {
    transcript.appendChild(el("div", { className: "preview-notice", text: model.transcriptMessage }));
  }

  const list = el("div", { className: "preview-list" });
  if (model.transcriptEntries?.length) {
    let previousDateKey = "";
    for (const entry of model.transcriptEntries) {
      const timestamp = timestampParts(entry.recordedAt);
      if (timestamp && timestamp.dateKey !== previousDateKey) {
        list.appendChild(dateSeparator(timestamp));
        previousDateKey = timestamp.dateKey;
      }
      list.appendChild(transcriptEntry(entry, timestamp));
    }
  } else {
    list.appendChild(el("div", {
      className: "empty",
      text: model.transcriptMessage || "No transcript preview available.",
    }));
  }
  transcript.appendChild(list);
}

function renderPreview(message) {
  const model = message.model || {};
  const body = previewBody();
  const sessionIdentity = String(message.sessionIdentity || "");
  const isNewSession = sessionIdentity !== activeSessionIdentity;
  const shouldFollowBottom = Boolean(message.initialScrollToBottom || isNewSession || isNearBottom());
  const previousScrollTop = body ? body.scrollTop : 0;

  activeSessionIdentity = sessionIdentity;
  setText("preview-title", model.title || "");
  setText("preview-meta", [model.project, model.status, model.shortSessionId].filter(Boolean).join(" | "));
  renderOpenAction(message);
  renderDetails(model);
  renderTranscript(model);

  if (shouldFollowBottom) {
    scrollToBottomAfterLayout();
    return;
  }

  if (body) {
    const maxScroll = Math.max(0, body.scrollHeight - body.clientHeight);
    body.scrollTop = Math.min(previousScrollTop, maxScroll);
    saveScroll();
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.addEventListener("message", (event) => {
    if (event.data?.type === "previewState") {
      renderPreview(event.data);
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    const body = previewBody();
    if (body) {
      body.addEventListener("scroll", saveScroll, { passive: true });
    }
    vscode.postMessage({ type: "previewReady" });
  });
}

if (typeof module !== "undefined") {
  module.exports = {
    timestampParts,
    transcriptEntry,
  };
}
