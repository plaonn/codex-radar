const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const {
  CodexAppServerController,
  normalizeCommand,
  threadListParams,
} = require("../src/codexAppServerController");

class FakeProcess extends EventEmitter {
  constructor(onMessage) {
    super();
    this.killed = false;
    this.messages = [];
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = {
      writable: true,
      end: () => {
        this.stdin.writable = false;
      },
      write: (value) => {
        const message = JSON.parse(String(value).trim());
        this.messages.push(message);
        onMessage(message, this);
        return true;
      },
    };
  }

  respond(message) {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  kill() {
    this.killed = true;
    return true;
  }
}

function successfulSpawn(calls) {
  return (command, args, options) => {
    const proc = new FakeProcess((message, current) => {
      setImmediate(() => {
        if (message.method === "initialize") {
          current.respond({ id: message.id, result: { userAgent: "codex-test" } });
        } else if (message.method === "thread/list") {
          const kind = message.params.archived ? "archived" : "active";
          current.respond({
            id: message.id,
            result: { data: [{ id: `${kind}-${calls.length}`, cwd: "/repo" }] },
          });
        } else if (message.method === "account/rateLimits/read") {
          current.respond({
            id: message.id,
            result: {
              rateLimits: {
                primary: { usedPercent: 42, windowDurationMins: 10080 },
              },
            },
          });
        }
      });
    });
    calls.push({ args, command, options, proc });
    return proc;
  };
}

test("normalizes the separately installed Codex command", () => {
  assert.equal(normalizeCommand(""), "codex");
  assert.equal(normalizeCommand("  /opt/codex  "), "/opt/codex");
});

test("builds lifecycle-neutral thread/list parameters", () => {
  assert.deepEqual(threadListParams(["/repo"], false, { limit: 10 }), {
    archived: false,
    limit: 10,
    sortKey: "updated_at",
    sortDirection: "desc",
    useStateDbOnly: false,
    cwd: "/repo",
  });
  assert.deepEqual(threadListParams(["C:\\a", "C:\\b"], true).cwd, ["C:\\a", "C:\\b"]);
});

test("initializes once and reuses one app-server process across catalog loads", async () => {
  const calls = [];
  const controller = new CodexAppServerController({
    clientVersion: "0.4.7",
    codexCommand: "/opt/codex",
    requestTimeoutMs: 100,
    spawn: successfulSpawn(calls),
  });

  const first = await controller.listThreads(["/repo"], { limit: 12 });
  const second = await controller.listThreads(["/repo"], { limit: 8 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/opt/codex");
  assert.deepEqual(calls[0].args, ["app-server", "--stdio"]);
  assert.deepEqual(calls[0].options, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  assert.deepEqual(first.active.data.map((thread) => thread.id), ["active-1"]);
  assert.deepEqual(first.archived.data.map((thread) => thread.id), ["archived-1"]);
  assert.deepEqual(second.active.data.map((thread) => thread.id), ["active-1"]);

  const initialize = calls[0].proc.messages.find((message) => message.method === "initialize");
  assert.equal(initialize.params.clientInfo.version, "0.4.7");
  assert.equal(calls[0].proc.messages.filter((message) => message.method === "initialize").length, 1);
  assert.equal(calls[0].proc.messages.filter((message) => message.method === "initialized").length, 1);
  assert.equal(calls[0].proc.messages.filter((message) => message.method === "thread/list").length, 4);

  controller.dispose();
  assert.equal(calls[0].proc.killed, true);
});

test("reads supported rate limits through the reused app-server process", async () => {
  const calls = [];
  const controller = new CodexAppServerController({
    requestTimeoutMs: 100,
    spawn: successfulSpawn(calls),
  });

  await controller.listThreads(["/repo"]);
  const response = await controller.readRateLimits({ timeoutMs: 100 });

  assert.equal(calls.length, 1);
  assert.equal(response.rateLimits.primary.usedPercent, 42);
  assert.equal(
    calls[0].proc.messages.filter((message) => message.method === "account/rateLimits/read").length,
    1,
  );
  controller.dispose();
});

test("concurrent catalog loads wait for one initialization handshake", async () => {
  const calls = [];
  const controller = new CodexAppServerController({
    requestTimeoutMs: 100,
    spawn: successfulSpawn(calls),
  });

  await Promise.all([
    controller.listThreads(["/repo"]),
    controller.listThreads(["/repo"]),
  ]);

  assert.equal(calls.length, 1);
  const methods = calls[0].proc.messages.map((message) => message.method);
  assert.equal(methods.filter((method) => method === "initialize").length, 1);
  assert.equal(methods.filter((method) => method === "initialized").length, 1);
  assert.equal(methods.indexOf("initialized") < methods.indexOf("thread/list"), true);
  controller.dispose();
});

test("reset stops the owned process and resolves the executable again", async () => {
  const calls = [];
  let command = "codex-one";
  const controller = new CodexAppServerController({
    codexCommandProvider: () => command,
    requestTimeoutMs: 100,
    spawn: successfulSpawn(calls),
  });

  await controller.listThreads(["/repo"]);
  command = "codex-two";
  controller.reset();
  await controller.listThreads(["/repo"]);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, "codex-one");
  assert.equal(calls[0].proc.killed, true);
  assert.equal(calls[1].command, "codex-two");
  controller.dispose();
});

test("initialization timeout cleans up the process and allows a later retry", async () => {
  const calls = [];
  const controller = new CodexAppServerController({
    requestTimeoutMs: 10,
    spawn: (command, args, options) => {
      const index = calls.length;
      const proc = new FakeProcess((message, current) => {
        if (index === 1 && message.method === "initialize") {
          setImmediate(() => current.respond({ id: message.id, result: {} }));
        } else if (index === 1 && message.method === "thread/list") {
          setImmediate(() => current.respond({ id: message.id, result: { data: [] } }));
        }
      });
      calls.push({ args, command, options, proc });
      return proc;
    },
  });

  await assert.rejects(controller.listThreads(["/repo"]), /initialize timed out/);
  assert.equal(calls[0].proc.killed, true);
  controller.requestTimeoutMs = 200;
  await controller.listThreads(["/repo"]);
  assert.equal(calls.length, 2);
  controller.dispose();
});

test("process exit rejects an in-flight request and restarts on the next load", async () => {
  const calls = [];
  const controller = new CodexAppServerController({
    requestTimeoutMs: 100,
    spawn: (command, args, options) => {
      const index = calls.length;
      const proc = new FakeProcess((message, current) => {
        setImmediate(() => {
          if (message.method === "initialize") {
            current.respond({ id: message.id, result: {} });
          } else if (index === 0 && message.method === "thread/list") {
            current.emit("exit", 1, null);
          } else if (message.method === "thread/list") {
            current.respond({ id: message.id, result: { data: [] } });
          }
        });
      });
      calls.push({ args, command, options, proc });
      return proc;
    },
  });

  await assert.rejects(controller.listThreads(["/repo"]), /exited with code 1/);
  await controller.listThreads(["/repo"]);
  assert.equal(calls.length, 2);
  controller.dispose();
});
