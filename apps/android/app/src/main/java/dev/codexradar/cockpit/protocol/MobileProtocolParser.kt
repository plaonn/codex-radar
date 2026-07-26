package dev.codexradar.cockpit.protocol

import dev.codexradar.cockpit.domain.Attention
import dev.codexradar.cockpit.domain.Preview
import dev.codexradar.cockpit.domain.RadarSession
import dev.codexradar.cockpit.domain.SessionId
import dev.codexradar.cockpit.domain.ThreadStatus
import org.json.JSONArray
import org.json.JSONObject

/** Neutral domain parser shared by fixture and SSH transports. */
object MobileProtocolParser {
    fun parseSessions(values: JSONArray): List<RadarSession> = (0 until values.length()).map { index ->
        val value = values.getJSONObject(index)
        RadarSession(
            id = SessionId(value.getString("session_id")),
            project = value.getString("project"),
            title = value.getString("session_id"),
            status = parseStatus(value.optString("display_status", value.optString("status"))),
            archived = value.optString("archive_state") == "archived",
            requiresAttention = value.getBoolean("requires_attention"),
        )
    }

    fun parsePreview(value: JSONObject, expectedSession: SessionId, limit: Int): Preview {
        check(value.getString("contract") == "codex-radar.transcript-preview")
        check(value.getInt("version") in 1..2)
        check(value.getString("session_id") == expectedSession.value)
        val messages = value.getJSONArray("messages")
        val lines = (0 until messages.length()).map { messages.getJSONObject(it).getString("text") }
        return Preview(expectedSession, lines.take(limit), limit)
    }

    fun parseAttention(value: JSONObject): Attention {
        check(value.getString("event") == "attention")
        val params = value.getJSONObject("params")
        val statusValue = params.getString("status")
        check(statusValue in setOf("waiting_approval", "done"))
        return Attention(
            sessionId = SessionId(params.getString("session_id")),
            project = params.getString("project"),
            status = parseStatus(statusValue),
        )
    }

    private fun parseStatus(value: String): ThreadStatus = when (value) {
        "waiting_approval" -> ThreadStatus.WAITING_APPROVAL
        "running" -> ThreadStatus.RUNNING
        "tool_running" -> ThreadStatus.TOOL_RUNNING
        "done" -> ThreadStatus.DONE
        else -> ThreadStatus.UNKNOWN
    }
}
