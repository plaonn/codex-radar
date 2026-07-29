package dev.codexradar.cockpit.domain

/** Opaque host-owned identity. It is never interpreted as a path or persisted. */
@JvmInline value class SessionId(val value: String)

enum class ConnectionPhase { DISCONNECTED, CONNECTING, REVIEW_HOST, CONNECTED, ERROR }
enum class ThreadStatus { WAITING_APPROVAL, RUNNING, TOOL_RUNNING, DONE, UNKNOWN }
enum class CockpitScreen { HOME, PROJECT, ARCHIVED, THREAD, CONNECTION_DETAILS, HOST_REVIEW }
enum class RefreshState { IDLE, LOADING, NO_CHANGE, UPDATED, ERROR }
enum class PrimaryConnectionAction {
    OPEN_CONNECTION_DETAILS,
    CONNECT,
    RESUME,
    CONNECTING,
    APPROVE_HOST,
    REFRESH,
    RETRY,
}

data class HostProfile(val label: String, val host: String, val port: Int, val user: String)
data class HostKeyReview(val algorithm: String, val sha256: String)
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

sealed interface CockpitRow {
    enum class Section { ATTENTION, RUNNING, PROJECTS, ARCHIVED }

    data class Header(val section: Section, val count: Int) : CockpitRow
    data class Thread(val session: RadarSession) : CockpitRow
    data class Project(val name: String, val count: Int) : CockpitRow
    data object Empty : CockpitRow
}

data class CockpitState(
    val phase: ConnectionPhase = ConnectionPhase.DISCONNECTED,
    val profile: HostProfile? = null,
    val sessions: List<RadarSession> = emptyList(),
    val screen: CockpitScreen = CockpitScreen.HOME,
    val project: String? = null,
    val selected: SessionId? = null,
    val preview: Preview? = null,
    val previewLoading: Boolean = false,
    val previewErrorCode: String? = null,
    val attention: Attention? = null,
    val hostKeyReview: HostKeyReview? = null,
    val errorCode: String? = null,
    val resumeRequired: Boolean = false,
    val refreshState: RefreshState = RefreshState.IDLE,
    val lastRefreshAtMillis: Long? = null,
) {
    fun attentionSessions(): List<RadarSession> =
        sessions.filter { !it.archived && it.requiresAttention }

    fun runningSessions(): List<RadarSession> = sessions.filter {
        !it.archived && !it.requiresAttention &&
            it.status in setOf(ThreadStatus.RUNNING, ThreadStatus.TOOL_RUNNING)
    }

    fun projects(): Map<String, List<RadarSession>> =
        sessions.filter { !it.archived }.groupBy { it.project }.toSortedMap()

    fun archived(): List<RadarSession> = sessions.filter { it.archived }

    fun selectedSession(): RadarSession? = selected?.let { selectedId ->
        sessions.firstOrNull { it.id == selectedId }
    }

    fun rows(): List<CockpitRow> = when (screen) {
        CockpitScreen.HOME -> buildList {
            val attentionRows = attentionSessions()
            add(CockpitRow.Header(CockpitRow.Section.ATTENTION, attentionRows.size))
            attentionRows.forEach { add(CockpitRow.Thread(it)) }

            val runningRows = runningSessions()
            add(CockpitRow.Header(CockpitRow.Section.RUNNING, runningRows.size))
            runningRows.forEach { add(CockpitRow.Thread(it)) }

            val projectRows = projects()
            add(CockpitRow.Header(CockpitRow.Section.PROJECTS, projectRows.size))
            projectRows.forEach { (name, sessions) ->
                add(CockpitRow.Project(name, sessions.size))
            }
        }
        CockpitScreen.PROJECT -> {
            val rows = sessions.filter { !it.archived && it.project == project }
                .sortedWith(
                    compareBy<RadarSession>(
                        { !it.requiresAttention },
                        { it.status !in setOf(ThreadStatus.RUNNING, ThreadStatus.TOOL_RUNNING) },
                        { it.title },
                    ),
                )
                .map(CockpitRow::Thread)
            rows.ifEmpty { listOf(CockpitRow.Empty) }
        }
        CockpitScreen.ARCHIVED -> buildList {
            val archivedRows = archived()
            add(CockpitRow.Header(CockpitRow.Section.ARCHIVED, archivedRows.size))
            archivedRows.forEach { add(CockpitRow.Thread(it)) }
            if (archivedRows.isEmpty()) add(CockpitRow.Empty)
        }
        else -> emptyList()
    }

    fun primaryAction(profileReady: Boolean, identityReady: Boolean): PrimaryConnectionAction =
        when (phase) {
            ConnectionPhase.DISCONNECTED -> when {
                !profileReady || !identityReady -> PrimaryConnectionAction.OPEN_CONNECTION_DETAILS
                resumeRequired -> PrimaryConnectionAction.RESUME
                else -> PrimaryConnectionAction.CONNECT
            }
            ConnectionPhase.CONNECTING -> PrimaryConnectionAction.CONNECTING
            ConnectionPhase.REVIEW_HOST -> PrimaryConnectionAction.APPROVE_HOST
            ConnectionPhase.CONNECTED -> PrimaryConnectionAction.REFRESH
            ConnectionPhase.ERROR -> when (errorCode) {
                "profile_required", "profile_invalid", "identity_missing" ->
                    PrimaryConnectionAction.OPEN_CONNECTION_DETAILS
                else -> PrimaryConnectionAction.RETRY
            }
        }
}

sealed interface CockpitEvent {
    data class Connect(val profile: HostProfile) : CockpitEvent
    data class ReviewHostKey(val review: HostKeyReview) : CockpitEvent
    data class Connected(
        val sessions: List<RadarSession>,
        val refreshedAtMillis: Long = 0L,
    ) : CockpitEvent
    data class Failed(val code: String) : CockpitEvent
    data object Disconnect : CockpitEvent
    data object ForegroundStopped : CockpitEvent
    data object RefreshStarted : CockpitEvent
    data class RefreshReconciled(
        val sessions: List<RadarSession>,
        val attention: Attention?,
        val refreshedAtMillis: Long,
    ) : CockpitEvent
    data class RefreshFailed(val code: String) : CockpitEvent
    data class OpenProject(val project: String) : CockpitEvent
    data object OpenArchived : CockpitEvent
    data class OpenThread(val sessionId: SessionId) : CockpitEvent
    data object OpenHome : CockpitEvent
    data object OpenConnectionDetails : CockpitEvent
    data object PreviewStarted : CockpitEvent
    data class PreviewLoaded(val preview: Preview) : CockpitEvent
    data class PreviewFailed(val code: String) : CockpitEvent
}

object CockpitReducer {
    fun reduce(old: CockpitState, event: CockpitEvent): CockpitState = when (event) {
        is CockpitEvent.Connect -> old.copy(
            phase = ConnectionPhase.CONNECTING,
            profile = event.profile,
            screen = CockpitScreen.HOME,
            project = null,
            selected = null,
            errorCode = null,
            attention = null,
            hostKeyReview = null,
            preview = null,
            previewLoading = false,
            previewErrorCode = null,
            resumeRequired = false,
            refreshState = RefreshState.LOADING,
        )
        is CockpitEvent.ReviewHostKey -> old.copy(
            phase = ConnectionPhase.REVIEW_HOST,
            screen = CockpitScreen.HOST_REVIEW,
            hostKeyReview = event.review,
            errorCode = null,
            attention = null,
            preview = null,
            previewLoading = false,
            previewErrorCode = null,
            refreshState = RefreshState.IDLE,
        )
        is CockpitEvent.Connected -> old.copy(
            phase = ConnectionPhase.CONNECTED,
            sessions = event.sessions,
            screen = CockpitScreen.HOME,
            project = null,
            selected = null,
            hostKeyReview = null,
            errorCode = null,
            resumeRequired = false,
            refreshState = RefreshState.UPDATED,
            lastRefreshAtMillis = event.refreshedAtMillis,
        )
        is CockpitEvent.Failed -> old.copy(
            phase = ConnectionPhase.ERROR,
            screen = CockpitScreen.HOME,
            project = null,
            selected = null,
            errorCode = event.code,
            hostKeyReview = null,
            preview = null,
            previewLoading = false,
            previewErrorCode = null,
            attention = null,
            refreshState = RefreshState.ERROR,
        )
        CockpitEvent.Disconnect -> CockpitState(
            phase = ConnectionPhase.DISCONNECTED,
            profile = old.profile,
            resumeRequired = false,
        )
        CockpitEvent.ForegroundStopped -> CockpitState(
            phase = ConnectionPhase.DISCONNECTED,
            profile = old.profile,
            resumeRequired = old.phase != ConnectionPhase.DISCONNECTED || old.resumeRequired,
        )
        CockpitEvent.RefreshStarted -> if (old.phase == ConnectionPhase.CONNECTED) {
            old.copy(refreshState = RefreshState.LOADING)
        } else {
            old
        }
        is CockpitEvent.RefreshReconciled -> {
            val noChange = old.sessions == event.sessions && event.attention == null
            val stillSelected = old.selected?.takeIf { selected ->
                event.sessions.any { it.id == selected }
            }
            old.copy(
                sessions = event.sessions,
                selected = stillSelected,
                screen = if (stillSelected == null && old.screen == CockpitScreen.THREAD) {
                    CockpitScreen.HOME
                } else {
                    old.screen
                },
                attention = event.attention ?: old.attention,
                errorCode = null,
                refreshState = if (noChange) RefreshState.NO_CHANGE else RefreshState.UPDATED,
                lastRefreshAtMillis = event.refreshedAtMillis,
            )
        }
        is CockpitEvent.RefreshFailed -> old.copy(
            refreshState = RefreshState.ERROR,
            errorCode = event.code,
        )
        is CockpitEvent.OpenProject -> if (old.projects().containsKey(event.project)) {
            old.copy(
                screen = CockpitScreen.PROJECT,
                project = event.project,
                selected = null,
                preview = null,
                previewLoading = false,
                previewErrorCode = null,
            )
        } else {
            old
        }
        CockpitEvent.OpenArchived -> old.copy(
            screen = CockpitScreen.ARCHIVED,
            project = null,
            selected = null,
            preview = null,
            previewLoading = false,
            previewErrorCode = null,
        )
        is CockpitEvent.OpenThread -> if (old.sessions.any { it.id == event.sessionId }) {
            old.copy(
                screen = CockpitScreen.THREAD,
                selected = event.sessionId,
                preview = null,
                previewLoading = false,
                previewErrorCode = null,
                attention = old.attention?.takeUnless { it.sessionId == event.sessionId },
            )
        } else {
            old
        }
        CockpitEvent.OpenHome -> old.copy(
            screen = CockpitScreen.HOME,
            project = null,
            selected = null,
            preview = null,
            previewLoading = false,
            previewErrorCode = null,
        )
        CockpitEvent.OpenConnectionDetails -> old.copy(
            screen = CockpitScreen.CONNECTION_DETAILS,
            project = null,
            selected = null,
            preview = null,
            previewLoading = false,
            previewErrorCode = null,
        )
        CockpitEvent.PreviewStarted -> if (
            old.screen == CockpitScreen.THREAD && old.selected != null
        ) {
            old.copy(preview = null, previewLoading = true, previewErrorCode = null)
        } else {
            old
        }
        is CockpitEvent.PreviewLoaded -> if (old.selected == event.preview.sessionId) {
            old.copy(
                preview = event.preview,
                previewLoading = false,
                previewErrorCode = null,
            )
        } else {
            old
        }
        is CockpitEvent.PreviewFailed -> old.copy(
            preview = null,
            previewLoading = false,
            previewErrorCode = event.code,
        )
    }
}
