const childProcess = require("node:child_process");

const DEFAULT_REQUEST_TIMEOUT_MS = 2500;
const DEFAULT_RATE_LIMITS_TIMEOUT_MS = 15000;
const MAX_STDERR_LENGTH = 8192;

function errorText(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function normalizeCommand(value) {
  const command = String(value || "").trim();
  return command || "codex";
}

function threadListParams(cwds, archived, options = {}) {
  const params = {
    archived,
    limit: options.limit ?? 200,
    sortKey: "updated_at",
    sortDirection: "desc",
    useStateDbOnly: false,
  };
  if (cwds.length === 1) {
    params.cwd = cwds[0];
  } else if (cwds.length > 1) {
    params.cwd = cwds;
  }
  return params;
}

class CodexAppServerController {
  constructor(options = {}) {
    this.spawn = options.spawn || childProcess.spawn;
    this.codexCommand = options.codexCommand || "codex";
    this.codexCommandProvider = options.codexCommandProvider || null;
    this.clientVersion = String(options.clientVersion || "0.0.0");
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.process = null;
    this.startPromise = null;
    this.pending = new Map();
    this.nextRequestId = 1;
    this.stdoutBuffer = "";
    this.stderr = "";
    this.disposed = false;
  }

  currentCommand() {
    if (typeof this.codexCommandProvider === "function") {
      return normalizeCommand(this.codexCommandProvider());
    }
    return normalizeCommand(this.codexCommand);
  }

  appendStderr(chunk) {
    this.stderr = `${this.stderr}${chunk.toString()}`.slice(-MAX_STDERR_LENGTH);
  }

  processError(message) {
    const detail = this.stderr.trim();
    return new Error(detail ? `${message}: ${detail}` : message);
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  detachProcess(proc, error) {
    if (this.process !== proc) {
      return;
    }
    this.process = null;
    this.stdoutBuffer = "";
    this.rejectPending(error);
  }

  handleMessage(message) {
    if (!Object.prototype.hasOwnProperty.call(message || {}, "id")) {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(errorText(message.error)));
      return;
    }
    pending.resolve(message.result);
  }

  handleStdout(chunk) {
    this.stdoutBuffer += chunk.toString();
    for (;;) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) {
        continue;
      }
      try {
        this.handleMessage(JSON.parse(line));
      } catch {
        // Ignore non-protocol noise from experimental app-server versions.
      }
    }
  }

  send(message) {
    const proc = this.process;
    if (!proc?.stdin?.writable) {
      throw this.processError("codex app-server stdin is not writable");
    }
    proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params, options = {}) {
    const proc = this.process;
    if (!proc) {
      return Promise.reject(this.processError("codex app-server is not running"));
    }
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) {
          return;
        }
        reject(this.processError(`codex app-server ${method} timed out`));
      }, options.timeoutMs ?? this.requestTimeoutMs);
      this.pending.set(id, { method, reject, resolve, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async startProcess() {
    const proc = this.spawn(this.currentCommand(), ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.process = proc;
    this.stdoutBuffer = "";
    this.stderr = "";

    proc.stdout.on("data", (chunk) => this.handleStdout(chunk));
    proc.stderr.on("data", (chunk) => this.appendStderr(chunk));
    proc.on("error", (error) => {
      this.detachProcess(proc, this.processError(`codex app-server failed: ${errorText(error)}`));
    });
    proc.on("exit", (code, signal) => {
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      this.detachProcess(proc, this.processError(`codex app-server exited with ${reason}`));
    });

    try {
      await this.request("initialize", {
        clientInfo: {
          name: "codex_radar_vscode",
          title: "Codex Radar VS Code",
          version: this.clientVersion,
        },
        capabilities: { experimentalApi: true },
      });
      this.send({ method: "initialized", params: {} });
    } catch (error) {
      this.stopProcess("Codex App Server Controller initialization failed");
      throw error;
    }
  }

  async ensureStarted() {
    if (this.disposed) {
      throw new Error("Codex App Server Controller is disposed");
    }
    if (this.startPromise) {
      await this.startPromise;
      return;
    }
    if (!this.process) {
      this.startPromise = this.startProcess().finally(() => {
        this.startPromise = null;
      });
      await this.startPromise;
    }
  }

  async listThreads(cwds, options = {}) {
    await this.ensureStarted();
    const [active, archived] = await Promise.all([
      this.request("thread/list", threadListParams(cwds, false, options), options),
      this.request("thread/list", threadListParams(cwds, true, options), options),
    ]);
    return { active, archived };
  }

  async readRateLimits(options = {}) {
    await this.ensureStarted();
    return this.request("account/rateLimits/read", {}, {
      ...options,
      timeoutMs: options.timeoutMs ?? DEFAULT_RATE_LIMITS_TIMEOUT_MS,
    });
  }

  stopProcess(reason) {
    const proc = this.process;
    if (!proc) {
      return;
    }
    this.process = null;
    this.stdoutBuffer = "";
    this.rejectPending(new Error(reason));
    try {
      proc.stdin.end();
    } catch {
      // Process may already be gone.
    }
    try {
      proc.kill();
    } catch {
      // Process may already be gone.
    }
  }

  reset() {
    this.stopProcess("Codex App Server Controller reset");
  }

  dispose() {
    this.disposed = true;
    this.stopProcess("Codex App Server Controller disposed");
  }
}

module.exports = {
  CodexAppServerController,
  DEFAULT_RATE_LIMITS_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  normalizeCommand,
  threadListParams,
};
