const assert = require("node:assert/strict");
const test = require("node:test");

const {
  configGetArgs,
  configSetRetentionArgs,
  DEFAULT_CLI_PATH,
  parseRetentionDaysOutput,
  pruneArgs,
  retentionDaysFromInput,
  validateRetentionDaysInput,
} = require("../src/radarCli");

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
