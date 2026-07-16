const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  defaultCodexHome,
  formatDurationUntil,
  formatReset,
  loadUsageSnapshot,
  semanticRateWindows,
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
  const homeDir = path.join(path.parse(process.cwd()).root, "home", "test");
  assert.equal(
    defaultCodexHome({ CODEX_HOME: "~/codex-home" }, homeDir),
    path.resolve(homeDir, "codex-home"),
  );
  assert.equal(defaultCodexHome({}, homeDir), path.join(homeDir, ".codex"));
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
    assert.equal(usageStatusText(snapshot), "$(hubot) -- · --");
    assert.match(usageStatusTooltip(snapshot), /rate_limits_unavailable/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("formats status text as remaining primary and secondary percentages", () => {
  assert.equal(
    usageStatusText({
      available: true,
      primary: { used_percent: 20, remaining_percent: 80 },
      secondary: { used_percent: 11, remaining_percent: 89 },
    }),
    "$(hubot) 80% · 89%",
  );
  assert.equal(
    usageStatusText({
      available: true,
      primary: { used_percent: 71, remaining_percent: 29 },
      secondary: { used_percent: 15, remaining_percent: 85 },
    }),
    "$(warning) 29% · 85%",
  );
  assert.equal(
    usageStatusText({
      available: true,
      primary: { used_percent: 97, remaining_percent: 3 },
      secondary: { used_percent: 15, remaining_percent: 85 },
    }),
    "$(error) 3% · 85%",
  );
});

test("places a lone seven-day primary window in the seven-day status slot", () => {
  const snapshot = {
    available: true,
    primary: {
      used_percent: 24,
      remaining_percent: 76,
      window_minutes: 10080,
      resets_at_iso: "2026-07-19T20:31:08.000Z",
    },
    secondary: null,
  };

  assert.deepEqual(semanticRateWindows(snapshot), {
    fiveHour: null,
    sevenDay: snapshot.primary,
  });
  assert.equal(usageStatusText(snapshot), "$(hubot) -- · 76%");
  assert.doesNotMatch(usageStatusTooltip(snapshot), /5h:/);
  assert.match(usageStatusTooltip(snapshot), /7d: 76% remaining/);
});

test("uses the lowest available semantic pool for the warning icon", () => {
  assert.equal(
    usageStatusText({
      available: true,
      primary: { remaining_percent: 8, window_minutes: 10080 },
      secondary: null,
    }),
    "$(error) -- · 8%",
  );
});

test("builds hover-compatible tooltip detail from usage snapshot", () => {
  const tooltip = usageStatusTooltip({
    available: true,
    plan_type: "prolite",
    primary: {
      used_percent: 97,
      remaining_percent: 3,
      resets_at_iso: "2026-07-05T21:00:08.000Z",
    },
    secondary: {
      used_percent: 15,
      remaining_percent: 85,
      resets_at_iso: "2026-07-12T16:00:08.000Z",
    },
    last_token_usage: { total_tokens: 145501 },
    context_window: 258400,
  }, { nowMs: Date.parse("2026-07-05T16:49:08.000Z") });

  assert.match(tooltip, /5h: 3% remaining/);
  assert.match(tooltip, / - reset: 4h 11m left \(/);
  assert.match(tooltip, /7d: 85% remaining/);
  assert.match(tooltip, /Plan: prolite/);
  assert.equal(tooltip.includes("Last turn tokens"), false);
  assert.equal(tooltip.includes("Context window"), false);
});

test("formats reset timestamps in extension host local time", () => {
  assert.match(formatReset("2026-07-05T21:00:08.000Z"), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("formats reset time remaining compactly", () => {
  assert.equal(
    formatDurationUntil("2026-07-05T21:00:08.000Z", Date.parse("2026-07-05T16:49:08.000Z")),
    "4h 11m left",
  );
  assert.equal(
    formatDurationUntil("2026-07-12T16:00:08.000Z", Date.parse("2026-07-05T16:49:08.000Z")),
    "6d 23h 11m left",
  );
});
