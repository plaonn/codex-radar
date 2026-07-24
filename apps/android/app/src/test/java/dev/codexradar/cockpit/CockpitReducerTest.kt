package dev.codexradar.cockpit

import dev.codexradar.cockpit.domain.*
import dev.codexradar.cockpit.protocol.FixtureProtocolClient
import org.junit.Assert.*
import org.junit.Test

class CockpitReducerTest {
    private val profile = HostProfile("fixture", "fixture.invalid", 22, "fixture")

    @Test fun connection_reconnect_discards_preview_and_attention() {
        val selected = SessionId("opaque-done")
        val connected = CockpitReducer.reduce(CockpitState(), CockpitEvent.Connect(profile))
        val loaded = CockpitReducer.reduce(connected, CockpitEvent.Connected(FixtureProtocolClient.scriptedSessions()))
        val preview = CockpitReducer.reduce(CockpitReducer.reduce(loaded, CockpitEvent.Select(selected)), CockpitEvent.PreviewLoaded(Preview(selected, listOf("redacted"), 1)))
        val noticed = CockpitReducer.reduce(preview, CockpitEvent.AttentionReceived(FixtureProtocolClient.scriptedAttention()))
        val reconnecting = CockpitReducer.reduce(noticed, CockpitEvent.Connect(profile))
        assertEquals(ConnectionPhase.CONNECTING, reconnecting.phase)
        assertNull(reconnecting.preview)
        assertNull(reconnecting.attention)
    }

    @Test fun attention_is_first_and_projects_exclude_attention_and_archived() {
        val state = CockpitReducer.reduce(CockpitState(), CockpitEvent.Connected(FixtureProtocolClient.scriptedSessions()))
        assertEquals(listOf("opaque-approval"), state.attentionSessions().map { it.id.value })
        assertEquals(listOf("Alpha", "Beta"), state.projects().keys.toList())
        assertEquals(listOf("opaque-archived"), state.archived().map { it.id.value })
    }

    @Test fun preview_requires_explicit_matching_selection_and_limit_is_bounded() {
        val sessions = FixtureProtocolClient.scriptedSessions()
        val selected = CockpitReducer.reduce(CockpitState(), CockpitEvent.Connected(sessions))
        val ignored = CockpitReducer.reduce(selected, CockpitEvent.PreviewLoaded(Preview(sessions[0].id, emptyList(), 200)))
        assertNull(ignored.preview)
        val ready = CockpitReducer.reduce(selected, CockpitEvent.Select(sessions[0].id))
        assertEquals(sessions[0].id, ready.selected)
    }

    @Test fun error_is_sanitized_code_not_transport_detail() {
        val failed = CockpitReducer.reduce(CockpitState(), CockpitEvent.Failed("fixture_unavailable"))
        assertEquals(ConnectionPhase.ERROR, failed.phase)
        assertEquals("fixture_unavailable", failed.errorCode)
    }

    @Test fun preview_failure_retains_connected_list_and_uses_bounded_code() {
        val connected = CockpitState(
            phase = ConnectionPhase.CONNECTED,
            sessions = FixtureProtocolClient.scriptedSessions(),
            selected = SessionId("opaque-approval"),
        )
        val failed = CockpitReducer.reduce(connected, CockpitEvent.PreviewFailed("fixture_preview_unavailable"))
        assertEquals(ConnectionPhase.CONNECTED, failed.phase)
        assertEquals(connected.sessions, failed.sessions)
        assertEquals("fixture_preview_unavailable", failed.previewErrorCode)
    }
}
