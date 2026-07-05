const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_CLI_PATH = "codex-radar";
const DEFAULT_PYTHON_PATH = "python3";

function configuredCliPath(vscode) {
  const configured = vscode.workspace.getConfiguration("codexRadar").get("cliPath", "");
  return typeof configured === "string" && configured.trim() ? configured.trim() : DEFAULT_CLI_PATH;
}

function configuredPythonPath(vscode) {
  const configured = vscode.workspace.getConfiguration("codexRadar").get("pythonPath", "");
  return typeof configured === "string" && configured.trim() ? configured.trim() : DEFAULT_PYTHON_PATH;
}

function prependPathEnv(existing, entry) {
  return existing ? `${entry}${path.delimiter}${existing}` : entry;
}

function workspaceSourceRoot(vscode) {
  const folders = vscode.workspace.workspaceFolders || [];
  for (const folder of folders) {
    const root = folder?.uri?.fsPath;
    if (!root) {
      continue;
    }
    if (fs.existsSync(path.join(root, "src", "codex_radar", "cli.py"))) {
      return root;
    }
  }
  return "";
}

function sourceRootCliInvocation(sourceRoot, pythonPath = DEFAULT_PYTHON_PATH) {
  const srcPath = path.join(sourceRoot, "src");
  return {
    command: pythonPath,
    argsPrefix: ["-m", "codex_radar.cli"],
    options: {
      cwd: sourceRoot,
      env: {
        ...process.env,
        PYTHONPATH: prependPathEnv(process.env.PYTHONPATH || "", srcPath),
      },
    },
    label: `${pythonPath} -m codex_radar.cli`,
  };
}

function configuredCliInvocation(vscode) {
  const configured = vscode.workspace.getConfiguration("codexRadar").get("cliPath", "");
  if (typeof configured === "string" && configured.trim()) {
    const command = configured.trim();
    return {
      command,
      argsPrefix: [],
      options: command === DEFAULT_CLI_PATH ? { shellLookup: true } : {},
      label: command,
    };
  }

  const sourceRoot = workspaceSourceRoot(vscode);
  if (sourceRoot) {
    return sourceRootCliInvocation(sourceRoot, configuredPythonPath(vscode));
  }

  return {
    command: DEFAULT_CLI_PATH,
    argsPrefix: [],
    options: { shellLookup: true },
    label: DEFAULT_CLI_PATH,
  };
}

function stateDirArgs(stateDir) {
  return ["--state-dir", stateDir];
}

function configGetArgs(stateDir, key) {
  return [...stateDirArgs(stateDir), "config", "get", key];
}

function configSetRetentionArgs(stateDir, days) {
  return [...stateDirArgs(stateDir), "config", "set", "retention_days", String(days)];
}

function pruneArgs(stateDir) {
  return [...stateDirArgs(stateDir), "prune"];
}

function parseRetentionDaysOutput(stdout) {
  const value = Number.parseInt(String(stdout || "").trim(), 10);
  return Number.isFinite(value) && value >= 0 ? value : 7;
}

function validateRetentionDaysInput(value) {
  const text = String(value || "").trim();
  if (!/^\d+$/.test(text)) {
    return "Enter a non-negative integer number of days.";
  }
  return undefined;
}

function retentionDaysFromInput(value) {
  return Number.parseInt(String(value || "").trim(), 10);
}

function normalizeInvocation(invocation) {
  if (typeof invocation === "string") {
    return {
      command: invocation,
      argsPrefix: [],
      options: {},
    };
  }
  return {
    command: invocation.command,
    argsPrefix: invocation.argsPrefix || [],
    options: invocation.options || {},
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function loginShellArgs(shellPath, command) {
  const shellName = path.basename(String(shellPath || ""));
  if (shellName === "sh" || shellName === "dash") {
    return ["-c", command];
  }
  return ["-lc", command];
}

function execFilePromise(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeoutMs ?? 10000,
        maxBuffer: options.maxBuffer ?? 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const message = String(stderr || error.message || "codex-radar command failed").trim();
          reject(new Error(message));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

async function resolveCommandFromLoginShell(command, options = {}) {
  const shellPath = options.shellPath || process.env.SHELL || "/bin/sh";
  const lookup = await execFilePromise(
    shellPath,
    loginShellArgs(shellPath, `command -v ${shellQuote(command)}`),
    {
      cwd: options.cwd,
      env: options.env,
      timeoutMs: options.timeoutMs ?? 10000,
      maxBuffer: options.maxBuffer ?? 1024 * 1024,
    },
  );
  return String(lookup.stdout || "").trim().split(/\r?\n/).find(Boolean) || "";
}

async function runRadarCli(invocation, args, options = {}) {
  const normalized = normalizeInvocation(invocation);
  const runOptions = {
    cwd: options.cwd || normalized.options.cwd,
    env: options.env || normalized.options.env,
    shellPath: options.shellPath || normalized.options.shellPath,
    timeoutMs: options.timeoutMs ?? 10000,
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
  };
  try {
    return await execFilePromise(
      normalized.command,
      [...normalized.argsPrefix, ...args],
      runOptions,
    );
  } catch (error) {
    const isMissingDefaultCommand =
      normalized.options.shellLookup &&
      normalized.command === DEFAULT_CLI_PATH &&
      error &&
      String(error.message || "").includes("ENOENT");
    if (!isMissingDefaultCommand) {
      throw error;
    }

    const resolved = await resolveCommandFromLoginShell(normalized.command, runOptions);
    if (!resolved) {
      throw error;
    }
    return execFilePromise(resolved, [...normalized.argsPrefix, ...args], runOptions);
  }
}

module.exports = {
  DEFAULT_CLI_PATH,
  DEFAULT_PYTHON_PATH,
  configGetArgs,
  configSetRetentionArgs,
  configuredCliInvocation,
  configuredCliPath,
  configuredPythonPath,
  loginShellArgs,
  parseRetentionDaysOutput,
  prependPathEnv,
  pruneArgs,
  resolveCommandFromLoginShell,
  retentionDaysFromInput,
  runRadarCli,
  sourceRootCliInvocation,
  shellQuote,
  validateRetentionDaysInput,
  workspaceSourceRoot,
};
