const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  configGetArgs,
  configSetRetentionArgs,
  configuredCliInvocation,
  DEFAULT_CLI_PATH,
  DEFAULT_PYTHON_PATH,
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
} = require("../src/radarCli");

function fakeVscode(configuration = {}, workspaceFolders = []) {
  return {
    workspace: {
      workspaceFolders: workspaceFolders.map((fsPath) => ({ uri: { fsPath } })),
      getConfiguration() {
        return {
          get(key, fallback = "") {
            return Object.prototype.hasOwnProperty.call(configuration, key)
              ? configuration[key]
              : fallback;
          },
        };
      },
    },
  };
}

test("builds codex-radar CLI args without shell quoting", () => {
  assert.equal(DEFAULT_CLI_PATH, "codex-radar");
  assert.deepEqual(configGetArgs("/tmp/radar state", "retention_days"), [
    "--state-dir",
    "/tmp/radar state",
    "config",
    "get",
    "retention_days",
  ]);
  assert.deepEqual(configSetRetentionArgs("/tmp/radar state", 14), [
    "--state-dir",
    "/tmp/radar state",
    "config",
    "set",
    "retention_days",
    "14",
  ]);
  assert.deepEqual(pruneArgs("/tmp/radar state"), ["--state-dir", "/tmp/radar state", "prune"]);
});

test("parses and validates retention days", () => {
  assert.equal(parseRetentionDaysOutput("14\n"), 14);
  assert.equal(parseRetentionDaysOutput("not-a-number"), 7);
  assert.equal(validateRetentionDaysInput("0"), undefined);
  assert.equal(validateRetentionDaysInput("7"), undefined);
  assert.equal(validateRetentionDaysInput("-1"), "Enter a non-negative integer number of days.");
  assert.equal(validateRetentionDaysInput("1.5"), "Enter a non-negative integer number of days.");
  assert.equal(retentionDaysFromInput(" 21 "), 21);
});

test("builds a source checkout CLI fallback when codex-radar is not configured", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-vscode-cli-"));
  const sourceRoot = path.join(tmp, "codex-radar");
  try {
    fs.mkdirSync(path.join(sourceRoot, "src", "codex_radar"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "src", "codex_radar", "cli.py"), "", "utf8");

    const vscode = fakeVscode({ pythonPath: "python3.12" }, [path.join(tmp, "other"), sourceRoot]);
    assert.equal(workspaceSourceRoot(vscode), sourceRoot);
    assert.deepEqual(configuredCliInvocation(vscode).argsPrefix, ["-m", "codex_radar.cli"]);
    assert.equal(configuredCliInvocation(vscode).command, "python3.12");
    assert.equal(configuredCliInvocation(vscode).options.cwd, sourceRoot);
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }
});

test("uses configured cliPath before source checkout fallback", () => {
  const invocation = configuredCliInvocation(fakeVscode({ cliPath: "/usr/local/bin/codex-radar" }));

  assert.deepEqual(invocation, {
    command: "/usr/local/bin/codex-radar",
    argsPrefix: [],
    options: {},
    label: "/usr/local/bin/codex-radar",
  });
});

test("falls back to codex-radar command when no source checkout is open", () => {
  const invocation = configuredCliInvocation(fakeVscode());

  assert.equal(invocation.command, DEFAULT_CLI_PATH);
  assert.equal(invocation.options.shellLookup, true);
  assert.equal(DEFAULT_PYTHON_PATH, "python3");
  assert.equal(prependPathEnv("/usr/bin", "/tmp/src"), `/tmp/src${path.delimiter}/usr/bin`);
});

test("runs CLI invocations with prefix args", async () => {
  const result = await runRadarCli(
    {
      command: process.execPath,
      argsPrefix: ["-e", "console.log(process.argv.slice(1).join('|'))", "--"],
      options: {},
    },
    ["--state-dir", "/tmp/radar state", "config", "get", "retention_days"],
  );

  assert.equal(result.stdout.trim(), "--state-dir|/tmp/radar state|config|get|retention_days");
});

test("quotes commands for shell lookup", () => {
  assert.equal(shellQuote("codex-radar"), "'codex-radar'");
  assert.equal(shellQuote("it's"), "'it'\\''s'");
  assert.deepEqual(loginShellArgs("/bin/zsh", "command -v codex-radar"), [
    "-lc",
    "command -v codex-radar",
  ]);
  assert.deepEqual(loginShellArgs("/bin/sh", "command -v codex-radar"), [
    "-c",
    "command -v codex-radar",
  ]);
});

test("resolves default codex-radar through a login shell after ENOENT", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-vscode-shell-"));
  const fakeCli = path.join(tmp, "codex-radar");
  const fakeShell = path.join(tmp, "fake-shell");
  try {
    fs.writeFileSync(
      fakeCli,
      "#!/bin/sh\nprintf 'fake-cli:%s\\n' \"$*\"\n",
      { mode: 0o755 },
    );
    fs.writeFileSync(
      fakeShell,
      `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(fakeCli)}\n`,
      { mode: 0o755 },
    );

    assert.equal(await resolveCommandFromLoginShell("codex-radar", { shellPath: fakeShell }), fakeCli);
    const result = await runRadarCli(
      {
        command: DEFAULT_CLI_PATH,
        argsPrefix: [],
        options: { shellLookup: true, shellPath: fakeShell },
      },
      ["config", "get", "retention_days"],
      { env: { PATH: "/usr/bin:/bin" } },
    );

    assert.equal(result.stdout.trim(), "fake-cli:config get retention_days");
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true });
  }
});
