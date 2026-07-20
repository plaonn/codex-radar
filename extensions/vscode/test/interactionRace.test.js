const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const warnings = [];
const vscode = {
  window: {
    async showWarningMessage(message) {
      warnings.push(message);
    },
  },
};

const originalLoad = Module._load;
Module._load = function loadWithVscodeStub(request, parent, isMain) {
  if (request === "vscode") {
    return vscode;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { RadarWebviewController } = require("../src/extension");
Module._load = originalLoad;

function session(sessionId, lastSeenAt) {
  return {
    session_id: sessionId,
    last_seen_at: lastSeenAt,
    display_status: "done",
  };
}

function controllerWithSessions(sessions) {
  const controller = Object.create(RadarWebviewController.prototype);
  controller.sessions = sessions;
  controller.latestInteractionAt = 0;
  controller.selectedKey = "";
  controller.selectedSessionIdentity = "";
  controller.refresh = async () => {};
  controller.openPreview = async (selected) => {
    controller.openedPreviews.push(selected.session_id);
  };
  controller.openedPreviews = [];
  return controller;
}

test.beforeEach(() => {
  warnings.length = 0;
});

test("resolves a delayed selection by stable session id after its state key changes", async () => {
  const current = session("session-a", "2026-07-15T10:01:00Z");
  const controller = controllerWithSessions([current]);

  await controller.handleMessage("projects", {
    type: "selectSession",
    sessionId: "session-a",
    key: "session-a\n2026-07-15T10:00:00Z",
    interactionAt: 100,
  });

  assert.equal(controller.selectedSessionIdentity, "session-a");
  assert.equal(controller.selectedKey, "session-a\n2026-07-15T10:01:00Z");
  assert.deepEqual(controller.openedPreviews, ["session-a"]);
  assert.deepEqual(warnings, []);
});

test("opens a sidebar preview before the full refresh completes", async () => {
  const controller = controllerWithSessions([
    session("session-a", "2026-07-15T10:01:00Z"),
  ]);
  const refreshCalls = [];
  let finishRefresh;
  controller.refresh = async (options) => {
    refreshCalls.push(options);
    await new Promise((resolve) => {
      finishRefresh = resolve;
    });
  };
  controller.updatePreviewPanel = () => {
    controller.previewRefreshes += 1;
  };
  controller.previewRefreshes = 0;

  await controller.handleMessage("projects", {
    type: "selectSession",
    sessionId: "session-a",
    interactionAt: 100,
  });

  assert.deepEqual(controller.openedPreviews, ["session-a"]);
  assert.deepEqual(refreshCalls, [{ updatePreview: false }]);
  assert.equal(controller.previewRefreshes, 0);

  finishRefresh();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(controller.previewRefreshes, 1);
});

test("does not start a stale refresh after a newer sidebar preview wins", async () => {
  const controller = controllerWithSessions([
    session("session-a", "2026-07-15T10:01:00Z"),
    session("session-b", "2026-07-15T10:02:00Z"),
  ]);
  let finishOlderPreview;
  controller.openPreview = async (selected) => {
    controller.openedPreviews.push(selected.session_id);
    if (selected.session_id === "session-a") {
      await new Promise((resolve) => {
        finishOlderPreview = resolve;
      });
    }
  };
  let refreshCount = 0;
  controller.refresh = async () => {
    refreshCount += 1;
  };

  const olderSelection = controller.handleMessage("projects", {
    type: "selectSession",
    sessionId: "session-a",
    interactionAt: 100,
  });
  await Promise.resolve();
  await controller.handleMessage("projects", {
    type: "selectSession",
    sessionId: "session-b",
    interactionAt: 200,
  });
  finishOlderPreview();
  await olderSelection;

  assert.deepEqual(controller.openedPreviews, ["session-a", "session-b"]);
  assert.equal(controller.selectedSessionIdentity, "session-b");
  assert.equal(refreshCount, 1);
});

test("does not refresh Preview after a newer interaction supersedes the selection", async () => {
  const controller = controllerWithSessions([
    session("session-a", "2026-07-15T10:01:00Z"),
  ]);
  let finishRefresh;
  controller.refresh = async () => {
    await new Promise((resolve) => {
      finishRefresh = resolve;
    });
  };
  controller.updatePreviewPanel = () => {
    controller.previewRefreshes += 1;
  };
  controller.previewRefreshes = 0;

  await controller.handleMessage("projects", {
    type: "selectSession",
    sessionId: "session-a",
    interactionAt: 100,
  });
  controller.beginInteraction({ interactionAt: 200 });
  finishRefresh();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(controller.previewRefreshes, 0);
});

test("ignores an older delayed click after a newer sidebar interaction", async () => {
  const controller = controllerWithSessions([
    session("session-a", "2026-07-15T10:01:00Z"),
    session("session-b", "2026-07-15T10:02:00Z"),
  ]);

  await controller.handleMessage("projects", {
    type: "selectSession",
    sessionId: "session-b",
    interactionAt: 200,
  });
  await controller.handleMessage("attention", {
    type: "selectSession",
    sessionId: "session-a",
    interactionAt: 100,
  });

  assert.equal(controller.selectedSessionIdentity, "session-b");
  assert.deepEqual(controller.openedPreviews, ["session-b"]);
});

test("an in-flight older action cannot restore its selection after a newer click", async () => {
  const controller = controllerWithSessions([
    session("session-a", "2026-07-15T10:01:00Z"),
    session("session-b", "2026-07-15T10:02:00Z"),
  ]);
  let finishMarkRead;
  controller.markSessionRead = async () => new Promise((resolve) => {
    finishMarkRead = resolve;
  });

  const olderAction = controller.handleMessage("projects", {
    type: "sessionAction",
    action: "markRead",
    sessionId: "session-a",
    interactionAt: 100,
  });
  await controller.handleMessage("projects", {
    type: "selectSession",
    sessionId: "session-b",
    interactionAt: 200,
  });
  finishMarkRead();
  await olderAction;

  assert.equal(controller.selectedSessionIdentity, "session-b");
  assert.deepEqual(controller.openedPreviews, ["session-b"]);
});
