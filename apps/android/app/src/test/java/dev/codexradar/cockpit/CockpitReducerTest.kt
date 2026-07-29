package dev.codexradar.cockpit

import dev.codexradar.cockpit.domain.*
import dev.codexradar.cockpit.protocol.FixtureProtocolClient
import org.junit.Assert.*
import org.junit.Test

class CockpitReducerTest {
    private val profile = HostProfile("fixture", "fixture.invalid", 22, "fixture")

    @Test fun reconnect_discards_detail_preview_and_attention() {
        val selected = SessionId("opaque-done")
        val loaded = CockpitReducer.reduce(
            CockpitState(),
            CockpitEvent.Connected(FixtureProtocolClient.scriptedSessions(), 1L),
        )
        val detail = CockpitReducer.reduce(loaded, CockpitEvent.OpenThread(selected))
        val preview = CockpitReducer.reduce(
            detail,
            CockpitEvent.PreviewLoaded(Preview(selected, listOf("redacted"), 1)),
        )
        val noticed = CockpitReducer.reduce(
            preview,
            CockpitEvent.RefreshReconciled(
                preview.sessions,
                FixtureProtocolClient.scriptedAttention(),
                2L,
            ),
        )
        val reconnecting = CockpitReducer.reduce(noticed, CockpitEvent.Connect(profile))
        assertEquals(ConnectionPhase.CONNECTING, reconnecting.phase)
        assertEquals(CockpitScreen.HOME, reconnecting.screen)
        assertNull(reconnecting.preview)
        assertNull(reconnecting.attention)
    }

    @Test fun home_rows_are_attention_then_running_then_projects_and_archived_is_separate() {
        val state = CockpitReducer.reduce(
            CockpitState(),
            CockpitEvent.Connected(FixtureProtocolClient.scriptedSessions(), 1L),
        )
        val rows = state.rows()
        assertEquals(
            listOf(
                CockpitRow.Section.ATTENTION,
                CockpitRow.Section.RUNNING,
                CockpitRow.Section.PROJECTS,
            ),
            rows.filterIsInstance<CockpitRow.Header>().map { it.section },
        )
        assertEquals(listOf("opaque-approval"), state.attentionSessions().map { it.id.value })
        assertEquals(listOf("opaque-running"), state.runningSessions().map { it.id.value })
        assertEquals(listOf("opaque-archived"), state.archived().map { it.id.value })
        assertFalse(rows.filterIsInstance<CockpitRow.Thread>().any { it.session.archived })
    }

    @Test fun each_connection_phase_has_one_state_aware_primary_action() {
        assertEquals(
            PrimaryConnectionAction.OPEN_CONNECTION_DETAILS,
            CockpitState().primaryAction(profileReady = false, identityReady = false),
        )
        assertEquals(
            PrimaryConnectionAction.CONNECT,
            CockpitState().primaryAction(profileReady = true, identityReady = true),
        )
        assertEquals(
            PrimaryConnectionAction.CONNECTING,
            CockpitState(phase = ConnectionPhase.CONNECTING)
                .primaryAction(profileReady = true, identityReady = true),
        )
        assertEquals(
            PrimaryConnectionAction.APPROVE_HOST,
            CockpitState(phase = ConnectionPhase.REVIEW_HOST)
                .primaryAction(profileReady = true, identityReady = true),
        )
        assertEquals(
            PrimaryConnectionAction.REFRESH,
            CockpitState(phase = ConnectionPhase.CONNECTED)
                .primaryAction(profileReady = true, identityReady = true),
        )
        assertEquals(
            PrimaryConnectionAction.RETRY,
            CockpitState(phase = ConnectionPhase.ERROR, errorCode = "protocol_failed")
                .primaryAction(profileReady = true, identityReady = true),
        )
    }

    @Test fun foreground_stop_requires_explicit_resume_and_clears_memory_only_state() {
        val connected = CockpitState(
            phase = ConnectionPhase.CONNECTED,
            profile = profile,
            sessions = FixtureProtocolClient.scriptedSessions(),
            selected = SessionId("opaque-done"),
            preview = Preview(SessionId("opaque-done"), listOf("redacted"), 1),
        )
        val stopped = CockpitReducer.reduce(connected, CockpitEvent.ForegroundStopped)
        assertEquals(ConnectionPhase.DISCONNECTED, stopped.phase)
        assertTrue(stopped.resumeRequired)
        assertTrue(stopped.sessions.isEmpty())
        assertNull(stopped.preview)
        assertEquals(
            PrimaryConnectionAction.RESUME,
            stopped.primaryAction(profileReady = true, identityReady = true),
        )
    }

    @Test fun preview_requires_dedicated_detail_and_explicit_request() {
        val sessions = FixtureProtocolClient.scriptedSessions()
        val selected = CockpitReducer.reduce(
            CockpitState(),
            CockpitEvent.Connected(sessions, 1L),
        )
        val ignored = CockpitReducer.reduce(
            selected,
            CockpitEvent.PreviewLoaded(Preview(sessions[0].id, emptyList(), 200)),
        )
        assertNull(ignored.preview)
        val detail = CockpitReducer.reduce(selected, CockpitEvent.OpenThread(sessions[0].id))
        assertEquals(CockpitScreen.THREAD, detail.screen)
        assertNull(detail.preview)
        val loading = CockpitReducer.reduce(detail, CockpitEvent.PreviewStarted)
        assertTrue(loading.previewLoading)
    }

    @Test fun attention_and_session_list_reconcile_in_one_refresh_event() {
        val old = RadarSession(SessionId("same"), "Alpha", "same", ThreadStatus.RUNNING)
        val refreshed = old.copy(status = ThreadStatus.DONE, requiresAttention = true)
        val connected = CockpitState(
            phase = ConnectionPhase.CONNECTED,
            sessions = listOf(old),
        )
        val reconciled = CockpitReducer.reduce(
            connected,
            CockpitEvent.RefreshReconciled(
                listOf(refreshed),
                Attention(refreshed.id, refreshed.project, refreshed.status),
                42L,
            ),
        )
        assertEquals(ThreadStatus.DONE, reconciled.sessions.single().status)
        assertEquals(refreshed.id, reconciled.attention?.sessionId)
        assertEquals(RefreshState.UPDATED, reconciled.refreshState)
        assertEquals(42L, reconciled.lastRefreshAtMillis)
    }

    @Test fun no_change_refresh_and_preview_error_preserve_connected_state() {
        val sessions = FixtureProtocolClient.scriptedSessions()
        val connected = CockpitState(
            phase = ConnectionPhase.CONNECTED,
            sessions = sessions,
            selected = SessionId("opaque-approval"),
        )
        val unchanged = CockpitReducer.reduce(
            connected,
            CockpitEvent.RefreshReconciled(sessions, null, 7L),
        )
        assertEquals(RefreshState.NO_CHANGE, unchanged.refreshState)
        val failed = CockpitReducer.reduce(
            unchanged,
            CockpitEvent.PreviewFailed("fixture_preview_unavailable"),
        )
        assertEquals(ConnectionPhase.CONNECTED, failed.phase)
        assertEquals(sessions, failed.sessions)
        assertEquals("fixture_preview_unavailable", failed.previewErrorCode)
    }
}
