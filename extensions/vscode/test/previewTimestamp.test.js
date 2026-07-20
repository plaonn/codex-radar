const assert = require("node:assert/strict");
const test = require("node:test");

const {
  timestampParts,
  transcriptEntry,
} = require("../media/preview");

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.className = "";
    this.textContent = "";
    this.innerHTML = "";
    this.dateTime = "";
    this.title = "";
  }

  appendChild(child) {
    this.children.push(child);
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }
}

test("formats visible preview time as local hour/minute and accessible metadata with seconds and timezone", () => {
  const value = "2026-07-14T00:01:02+00:00";
  const date = new Date(value);
  const parts = timestampParts(value);
  const visibleOptions = {
    hour: "2-digit",
    minute: "2-digit",
  };
  const accessibleOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  };

  assert.equal(parts.timeText, date.toLocaleTimeString(undefined, visibleOptions));
  assert.equal(parts.accessibleText, date.toLocaleString(undefined, accessibleOptions));
  assert.equal(
    new Intl.DateTimeFormat(undefined, visibleOptions)
      .formatToParts(date)
      .some((part) => part.type === "second"),
    false,
  );
  const accessiblePartTypes = new Set(
    new Intl.DateTimeFormat(undefined, accessibleOptions)
      .formatToParts(date)
      .map((part) => part.type),
  );
  assert.equal(accessiblePartTypes.has("year"), true);
  assert.equal(accessiblePartTypes.has("month"), true);
  assert.equal(accessiblePartTypes.has("day"), true);
  assert.equal(accessiblePartTypes.has("hour"), true);
  assert.equal(accessiblePartTypes.has("minute"), true);
  assert.equal(accessiblePartTypes.has("second"), true);
  assert.equal(accessiblePartTypes.has("timeZoneName"), true);
});

test("renders full local timestamp in hover and accessibility metadata", () => {
  const originalDocument = global.document;
  global.document = {
    createElement: (tagName) => new FakeNode(tagName),
  };
  try {
    const recordedAt = "2026-07-14T00:01:02+00:00";
    const parts = timestampParts(recordedAt);
    const article = transcriptEntry({
      role: "assistant",
      label: "Codex",
      html: "<p>done</p>",
      recordedAt,
    }, parts);
    const time = article.children.at(-1);

    assert.equal(time.tagName, "time");
    assert.equal(time.textContent, parts.timeText);
    assert.equal(time.dateTime, recordedAt);
    assert.equal(time.title, parts.accessibleText);
    assert.equal(time.attributes["aria-label"], `Recorded ${parts.accessibleText}`);
  } finally {
    global.document = originalDocument;
  }
});

test("omits timestamp metadata when a message has no valid timestamp", () => {
  const originalDocument = global.document;
  global.document = {
    createElement: (tagName) => new FakeNode(tagName),
  };
  try {
    assert.equal(timestampParts("not-a-timestamp"), null);
    const article = transcriptEntry({
      role: "user",
      label: "You",
      html: "<p>hello</p>",
    }, null);
    assert.equal(article.children.length, 2);
  } finally {
    global.document = originalDocument;
  }
});
