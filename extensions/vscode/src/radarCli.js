const { execFile } = require("node:child_process");

const DEFAULT_CLI_PATH = "codex-radar";

function configuredCliPath(vscode) {
  const configured = vscode.workspace.getConfiguration("codexRadar").get("cliPath", "");
  return typeof configured === "string" && configured.trim() ? configured.trim() : DEFAULT_CLI_PATH;
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

function runRadarCli(cliPath, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      cliPath,
      args,
      {
        cwd: options.cwd,
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

module.exports = {
  DEFAULT_CLI_PATH,
  configGetArgs,
  configSetRetentionArgs,
  configuredCliPath,
  parseRetentionDaysOutput,
  pruneArgs,
  retentionDaysFromInput,
  runRadarCli,
  validateRetentionDaysInput,
};
