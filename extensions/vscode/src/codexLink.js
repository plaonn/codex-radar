function officialCodexThreadUriString(session) {
  const sessionId = String(session?.session_id || "").trim();
  if (!sessionId || sessionId === "unknown" || sessionId.startsWith("unknown:")) {
    return null;
  }
  return `vscode://openai.chatgpt/local/${encodeURIComponent(sessionId)}`;
}

module.exports = {
  officialCodexThreadUriString,
};
