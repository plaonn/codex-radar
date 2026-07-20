function resumableSessionId(session) {
  const sessionId = String(session?.session_id || session?.sessionId || "").trim();
  if (!sessionId || sessionId === "unknown" || sessionId.startsWith("unknown:")) {
    return "";
  }
  return sessionId;
}

function codexResumeTerminalOptions(session, codexExecutable) {
  const sessionId = resumableSessionId(session);
  if (!sessionId) {
    return null;
  }

  const executable = String(codexExecutable || "").trim() || "codex";
  const cwd = typeof session?.cwd === "string" && session.cwd.trim() ? session.cwd : undefined;
  return {
    name: `Codex: ${sessionId.slice(0, 12)}`,
    shellPath: executable,
    shellArgs: ["resume", sessionId],
    ...(cwd ? { cwd } : {}),
  };
}

module.exports = {
  codexResumeTerminalOptions,
  resumableSessionId,
};
