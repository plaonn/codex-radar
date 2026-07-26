package dev.codexradar.cockpit.protocol

import android.content.Context
import android.os.Handler
import android.os.Looper
import dev.codexradar.cockpit.domain.Attention
import dev.codexradar.cockpit.domain.CockpitEvent
import dev.codexradar.cockpit.domain.HostProfile
import dev.codexradar.cockpit.domain.Preview
import dev.codexradar.cockpit.domain.RadarSession
import dev.codexradar.cockpit.domain.SessionId
import dev.codexradar.cockpit.domain.ThreadStatus
import org.json.JSONObject
import org.json.JSONArray

/**
 * A2-only transport. It replays the checked-in golden exchange and deliberately
 * has no socket, process, credential, or persistence capability.
 */
class FixtureProtocolClient(private val context: Context) {
    private val maxRequestFrameBytes = 1_048_576
    private var attentionBaselineEstablished = false

    fun connect(profile: HostProfile, emit: (CockpitEvent) -> Unit) {
        emit(CockpitEvent.Connect(profile))
        attentionBaselineEstablished = false
        Handler(Looper.getMainLooper()).post {
            try {
                val root = loadFixture()
                check(root.getString("fixture_contract") == "codex-radar.read-protocol")
                check(root.getInt("fixture_version") == 1)
                val initialized = resultFor(root, "initialize")
                check(initialized.getString("protocol") == "codex-radar.read-protocol")
                check(initialized.getInt("version") == 1)
                check(initialized.getInt("preview_contract_version") in 1..2)
                check(initialized.getString("attention_delivery") == "foreground-poll")
                val state = resultFor(root, "state/read")
                check(state.getString("contract") == "codex-radar.display-state")
                check(state.getInt("version") == 1)
                emit(CockpitEvent.Connected(MobileProtocolParser.parseSessions(state.getJSONArray("sessions"))))
            } catch (_: Exception) {
                emit(CockpitEvent.Failed("fixture_unavailable"))
            }
        }
    }

    fun readPreview(session: RadarSession, limit: Int, emit: (CockpitEvent) -> Unit) {
        val bounded = limit.coerceIn(1, 200)
        try {
            val result = resultFor(loadFixture(), "preview/read")
            check(result.getString("contract") == "codex-radar.transcript-preview")
            check(result.getInt("version") in 1..2)
            check(result.getString("session_id") == session.id.value)
            val lines = result.getJSONArray("messages").strings("text")
            emit(CockpitEvent.PreviewLoaded(Preview(session.id, lines.take(bounded), bounded)))
        } catch (_: Exception) {
            emit(CockpitEvent.PreviewFailed("fixture_preview_unavailable"))
        }
    }

    /** First poll establishes a baseline. A later fixture poll emits one foreground-only event. */
    fun pollAttention(sessions: List<RadarSession>, emit: (CockpitEvent) -> Unit) {
        if (!attentionBaselineEstablished) {
            attentionBaselineEstablished = true
            return
        }
        sessions.firstOrNull { it.requiresAttention }?.let {
            emit(CockpitEvent.AttentionReceived(Attention(it.id, it.project, it.status)))
        }
    }

    private fun loadFixture(): JSONObject {
        val bytes = context.assets.open("mobile-rpc-v1.rich.json").use { it.readBytes() }
        check(bytes.size <= maxRequestFrameBytes)
        return JSONObject(bytes.toString(Charsets.UTF_8))
    }

    private fun resultFor(root: JSONObject, method: String): JSONObject {
        val exchanges = root.getJSONArray("exchanges")
        return (0 until exchanges.length()).map { exchanges.getJSONObject(it) }
            .first { it.getJSONObject("request").getString("method") == method }
            .getJSONArray("messages").getJSONObject(0).getJSONObject("result")
    }

    /** Test values preserve host-supplied display fields without adding transport semantics. */
    companion object {
        private fun JSONArray.strings(key: String): List<String> = (0 until length()).map { getJSONObject(it).getString(key) }
        fun scriptedSessions(): List<RadarSession> = listOf(
            RadarSession(SessionId("opaque-approval"), "Alpha", "Approval needed", ThreadStatus.WAITING_APPROVAL, requiresAttention = true),
            RadarSession(SessionId("opaque-running"), "Alpha", "Build", ThreadStatus.RUNNING),
            RadarSession(SessionId("opaque-done"), "Beta", "Review", ThreadStatus.DONE),
            RadarSession(SessionId("opaque-archived"), "Alpha", "Prior run", ThreadStatus.DONE, archived = true),
        )
        fun scriptedAttention(): Attention = Attention(SessionId("opaque-done"), "Beta", ThreadStatus.DONE)
    }
}
