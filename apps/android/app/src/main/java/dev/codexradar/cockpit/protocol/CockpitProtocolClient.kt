package dev.codexradar.cockpit.protocol

import dev.codexradar.cockpit.domain.CockpitEvent
import dev.codexradar.cockpit.domain.RadarSession

/** UI-facing boundary shared by deterministic fixtures and the foreground SSH client. */
interface CockpitProtocolClient {
    fun connect(emit: (CockpitEvent) -> Unit)
    fun readPreview(session: RadarSession, limit: Int, emit: (CockpitEvent) -> Unit)
    fun pollAttention(emit: (CockpitEvent) -> Unit)
    fun disconnect()
}
