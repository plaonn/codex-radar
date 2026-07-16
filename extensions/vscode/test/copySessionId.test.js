const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const clipboardWrites = [];
const statusMessages = [];
const vscode = {
  env: {
    clipboard: {
      async writeText(value) {
        clipboardWrites.push(value);
      },
    },
  },
  window: {
    setStatusBarMessage(message, timeout) {
      statusMessages.push({ message, timeout });
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

test.beforeEach(() => {
  clipboardWrites.length = 0;
  statusMessages.length = 0;
});

test("copies the exact full session id received from the sidebar", async () => {
  const sessionId = "019f0000-1111-7222-8333-444444444444";
  const receiver = Object.create(RadarWebviewController.prototype);
  receiver.latestInteractionAt = 0;

  await RadarWebviewController.prototype.handleMessage.call(receiver, "projects", {
    type: "copySessionId",
    sessionId,
    interactionAt: 100,
  });

  assert.deepEqual(clipboardWrites, [sessionId]);
  assert.deepEqual(statusMessages, [{ message: "Copied Codex session id", timeout: 1800 }]);
});

test("does not write an empty session id to the clipboard", async () => {
  await RadarWebviewController.prototype.copySessionId.call({}, "   ");

  assert.deepEqual(clipboardWrites, []);
  assert.deepEqual(statusMessages, []);
});
