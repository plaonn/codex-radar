const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const createdTerminals = [];
const shownTerminals = [];
const vscode = {
  window: {
    createTerminal(options) {
      createdTerminals.push(options);
      return {
        show() {
          shownTerminals.push(options);
        },
      };
    },
    async showWarningMessage() {},
  },
};

const originalLoad = Module._load;
Module._load = function loadWithVscodeStub(request, parent, isMain) {
  if (request === "vscode") {
    return vscode;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { openCodexCliTerminal } = require("../src/extension");
Module._load = originalLoad;

test.beforeEach(() => {
  createdTerminals.length = 0;
  shownTerminals.length = 0;
});

test("opens a user-visible integrated terminal with structured executable, argv, and cwd", async () => {
  const sessionId = "019f0000-1111-7222-8333-444444444444";
  const result = await openCodexCliTerminal({
    session_id: sessionId,
    cwd: "/repo with spaces",
  }, {
    codexExecutable: "/opt/Codex CLI/bin/codex",
  });

  assert.equal(result.opened, true);
  assert.deepEqual(createdTerminals, [{
    name: "Codex: 019f0000-111",
    shellPath: "/opt/Codex CLI/bin/codex",
    shellArgs: ["resume", sessionId],
    cwd: "/repo with spaces",
  }]);
  assert.deepEqual(shownTerminals, createdTerminals);
});
