package dev.codexradar.cockpit.domain

/** Opaque host-owned identity. It is never interpreted as a path or persisted. */
@JvmInline value class SessionId(val value: String)

enum class ConnectionPhase { DISCONNECTED, CONNECTING, CONNECTED, ERROR }
enum class ThreadStatus { WAITING_APPROVAL, RUNNING, TOOL_RUNNING, DONE, UNKNOWN }

data class HostProfile(val label: String, val host: String, val port: Int, val user: String)
data class RadarSession(
    val id: SessionId,
    val project: String,
    val title: String,
    val status: ThreadStatus,
    val archived: Boolean = false,
    val requiresAttention: Boolean = false,
)
data class Preview(val sessionId: SessionId, val lines: List<String>, val limit: Int)
data class Attention(val sessionId: SessionId, val project: String, val status: ThreadStatus)

data class CockpitState(
    val phase: ConnectionPhase = ConnectionPhase.DISCONNECTED,
    val profile: HostProfile? = null,
    val sessions: List<RadarSession> = emptyList(),
    val selected: SessionId? = null,
    val preview: Preview? = null,
    val previewErrorCode: String? = null,
    val attention: Attention? = null,
    val errorCode: String? = null,
) {
    /** Attention is first; remaining active threads retain project grouping. */
    fun attentionSessions(): List<RadarSession> = sessions.filter { !it.archived && it.requiresAttention }
    fun projects(): Map<String, List<RadarSession>> = sessions
        .filter { !it.archived && !it.requiresAttention }
        .groupBy { it.project }
        .toSortedMap()
    fun archived(): List<RadarSession> = sessions.filter { it.archived }
}

sealed interface CockpitEvent {
    data class Connect(val profile: HostProfile) : CockpitEvent
    data class Connected(val sessions: List<RadarSession>) : CockpitEvent
    data class Failed(val code: String) : CockpitEvent
    data object Disconnect : CockpitEvent
    data class Select(val sessionId: SessionId) : CockpitEvent
    data class PreviewLoaded(val preview: Preview) : CockpitEvent
    data class PreviewFailed(val code: String) : CockpitEvent
    data class AttentionReceived(val attention: Attention) : CockpitEvent
}

object CockpitReducer {
    fun reduce(old: CockpitState, event: CockpitEvent): CockpitState = when (event) {
        is CockpitEvent.Connect -> old.copy(phase = ConnectionPhase.CONNECTING, profile = event.profile, errorCode = null, attention = null, preview = null, previewErrorCode = null)
        is CockpitEvent.Connected -> old.copy(phase = ConnectionPhase.CONNECTED, sessions = event.sessions, errorCode = null)
        is CockpitEvent.Failed -> old.copy(phase = ConnectionPhase.ERROR, errorCode = event.code, preview = null, previewErrorCode = null, attention = null)
        CockpitEvent.Disconnect -> CockpitState(phase = ConnectionPhase.DISCONNECTED, profile = old.profile)
        is CockpitEvent.Select -> if (old.sessions.any { it.id == event.sessionId }) old.copy(selected = event.sessionId, preview = null, previewErrorCode = null) else old
        is CockpitEvent.PreviewLoaded -> if (old.selected == event.preview.sessionId) old.copy(preview = event.preview, previewErrorCode = null) else old
        is CockpitEvent.PreviewFailed -> old.copy(preview = null, previewErrorCode = event.code)
        is CockpitEvent.AttentionReceived -> old.copy(attention = event.attention)
    }
}
