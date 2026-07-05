const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  defaultCodexHome,
  loadUsageSnapshot,
  usageStatusText,
  usageStatusTooltip,
} = require("../src/usageSource");

function writeRollout(filePath, lines) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n") + "\n",
    "utf8",
  );
}

test("resolves Codex home from extension host environment", () => {
  assert.equal(defaultCodexHome({ CODEX_HOME: "~/codex-home" }, "/home/test"), "/home/test/codex-home");
  assert.equal(defaultCodexHome({}, "/home/test"), "/home/test/.codex");
});

test("loads latest token_count rate limits without exposing rollout path", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-usage-"));
  try {
    const codexHome = path.join(tmp, "codex-home");
    writeRollout(path.join(codexHome, "sessions", "2026", "07", "06", "rollout-usage.jsonl"), [
      "broken json",
      {
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            model_context_window: 258400,
            last_token_usage: { total_tokens: 100 },
            total_token_usage: { total_tokens: 500 },
          },
          rate_limits: {
            limit_id: "codex",
            plan_type: "prolite",
            primary: { used_percent: 71, window_minutes: 300, resets_at: 1783285208 },
            secondary: { used_percent: 11, window_minutes: 10080, resets_at: 1783872008 },
          },
        },
      },
    ]);

    const snapshot = loadUsageSnapshot({ codexHome });

    assert.equal(snapshot.available, true);
    assert.equal(snapshot.primary.used_percent, 71);
    assert.equal(snapshot.primary.remaining_percent, 29);
    assert.equal(snapshot.primary.resets_at_iso, "2026-07-05T21:00:08.000Z");
    assert.equal(snapshot.secondary.used_percent, 11);
    assert.equal(snapshot.plan_type, "prolite");
    assert.equal(snapshot.context_window, 258400);
    assert.equal(JSON.stringify(snapshot).includes(codexHome), false);
    assert.equal(JSON.stringify(snapshot).includes("rollout-usage"), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("returns unavailable when rate limits are missing", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-radar-usage-"));
  try {
    const codexHome = path.join(tmp, "codex-home");
    writeRollout(path.join(codexHome, "sessions", "2026", "07", "06", "rollout-null.jsonl"), [
      { type: "event_msg", payload: { type: "token_count", info: {}, rate_limits: null } },
    ]);

    const snapshot = loadUsageSnapshot({ codexHome });

    assert.equal(snapshot.available, false);
    assert.equal(snapshot.reason, "rate_limits_unavailable");
    assert.equal(usageStatusText(snapshot), "$(pulse) Codex --");
    assert.match(usageStatusTooltip(snapshot), /rate_limits_unavailable/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("formats usage status text by threshold", () => {
  assert.equal(usageStatusText({ available: true, primary: { used_percent: 20 } }), "$(pulse) Codex 20%");
  assert.equal(usageStatusText({ available: true, primary: { used_percent: 71 } }), "$(warning) Codex 71%");
  assert.equal(usageStatusText({ available: true, primary: { used_percent: 90 } }), "$(error) Codex 90%");
});
