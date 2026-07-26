package dev.codexradar.cockpit.protocol

import dev.codexradar.cockpit.domain.RadarSession
import dev.codexradar.cockpit.domain.SessionId
import dev.codexradar.cockpit.domain.ThreadStatus
import org.json.JSONArray

/** Neutral A2 domain parser reused by the isolated A3.0 compatibility spike. */
object MobileProtocolParser {
    fun parseSessions(values: JSONArray): List<RadarSession> = (0 until values.length()).map { index ->
        val value = values.getJSONObject(index)
        RadarSession(
            id = SessionId(value.getString("session_id")),
            project = value.getString("project"),
            title = value.getString("session_id"),
            status = when (value.getString("display_status")) {
                "waiting_approval" -> ThreadStatus.WAITING_APPROVAL
                "running" -> ThreadStatus.RUNNING
                "tool_running" -> ThreadStatus.TOOL_RUNNING
                "done" -> ThreadStatus.DONE
                else -> ThreadStatus.UNKNOWN
            },
            archived = value.optString("archive_state") == "archived",
            requiresAttention = value.getBoolean("requires_attention"),
        )
    }
}
