package dev.codexradar.cockpit.protocol

import android.os.Handler
import android.os.Looper
import dev.codexradar.cockpit.domain.CockpitEvent
import dev.codexradar.cockpit.domain.HostKeyReview
import dev.codexradar.cockpit.domain.RadarSession
import dev.codexradar.cockpit.profile.PersistedHostProfile
import dev.codexradar.cockpit.profile.HostKeyPin
import dev.codexradar.cockpit.transport.JschForegroundTransport
import dev.codexradar.cockpit.transport.TransportConnectResult
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future

/**
 * Serial foreground-only owner. Generation checks discard callbacks from a
 * connection that was stopped or replaced; every connect creates fresh SSH/RPC state.
 */
class ForegroundSshProtocolClient(
    private var profile: PersistedHostProfile,
    private val main: Handler = Handler(Looper.getMainLooper()),
    private val executor: ExecutorService = Executors.newSingleThreadExecutor(),
    private val transportFactory: ((String) -> Unit) -> JschForegroundTransport =
        { listener -> JschForegroundTransport(listener) },
) : CockpitProtocolClient {
    private val lock = Any()
    private var generation = 0L
    private var transport: JschForegroundTransport? = null
    private var work: Future<*>? = null
    @Volatile private var pendingPin: HostKeyPin? = null
    private var terminalGeneration: Long? = null

    override fun connect(emit: (CockpitEvent) -> Unit) {
        val token = synchronized(lock) {
            generation += 1
            work?.cancel(true)
            transport?.close()
            transport = null
            terminalGeneration = null
            generation
        }
        emit(CockpitEvent.Connect(profile.domainProfile()))
        pendingPin = null
        work = executor.submit {
            val fresh = transportFactory { code ->
                synchronized(lock) {
                    if (token == generation) {
                        terminalGeneration = token
                        transport = null
                    }
                }
                post(token, emit, CockpitEvent.Failed(code))
            }
            synchronized(lock) {
                if (token != generation) {
                    fresh.close()
                    return@submit
                }
                transport = fresh
            }
            val event = when (val result = fresh.connect(profile)) {
                is TransportConnectResult.Connected -> try {
                    CockpitEvent.Connected(
                        MobileProtocolParser.parseSessions(result.state.getJSONArray("sessions")),
                        System.currentTimeMillis(),
                    )
                } catch (_: Exception) {
                    fresh.close()
                    CockpitEvent.Failed("protocol_failed")
                }
                is TransportConnectResult.HostReviewRequired -> {
                    pendingPin = result.presented.pin()
                    CockpitEvent.ReviewHostKey(
                        HostKeyReview(result.presented.algorithm, result.presented.sha256),
                    )
                }
                is TransportConnectResult.Failed -> CockpitEvent.Failed(result.code)
            }
            if (synchronized(lock) { terminalGeneration == token }) return@submit
            post(token, emit, event)
        }
    }

    fun updateProfile(value: PersistedHostProfile) {
        synchronized(lock) { profile = value }
    }

    fun pendingHostKeyPin(): HostKeyPin? = pendingPin

    override fun readPreview(
        session: RadarSession,
        limit: Int,
        emit: (CockpitEvent) -> Unit,
    ) = submitConnected(emit, CockpitEvent.PreviewFailed("preview_unavailable")) { owned ->
        try {
            CockpitEvent.PreviewLoaded(
                MobileProtocolParser.parsePreview(
                    owned.readPreview(session.id.value, limit),
                    session.id,
                    limit.coerceIn(1, 200),
                ),
            )
        } catch (_: RemoteMethodError) {
            CockpitEvent.PreviewFailed("preview_unavailable")
        } catch (_: Exception) {
            owned.close()
            CockpitEvent.Failed("protocol_failed")
        }
    }

    override fun pollAttention(emit: (CockpitEvent) -> Unit) {
        val (token, owned) = synchronized(lock) { generation to transport }
        if (owned == null) {
            emit(CockpitEvent.RefreshFailed("connection_unavailable"))
            return
        }
        work = executor.submit {
            try {
                val result = owned.pollAttentionAndReadState()
                val attention = result.poll.events.lastOrNull()?.let {
                    MobileProtocolParser.parseAttention(it)
                }
                post(
                    token,
                    emit,
                    CockpitEvent.RefreshReconciled(
                        sessions = MobileProtocolParser.parseSessions(
                            result.state.getJSONArray("sessions"),
                        ),
                        attention = attention,
                        refreshedAtMillis = System.currentTimeMillis(),
                    ),
                )
            } catch (_: RemoteMethodError) {
                post(token, emit, CockpitEvent.RefreshFailed("refresh_unavailable"))
            } catch (_: Exception) {
                owned.close()
                post(token, emit, CockpitEvent.Failed("protocol_failed"))
            }
        }
    }

    private fun submitConnected(
        emit: (CockpitEvent) -> Unit,
        missing: CockpitEvent?,
        operation: (JschForegroundTransport) -> CockpitEvent?,
    ) {
        val (token, owned) = synchronized(lock) { generation to transport }
        if (owned == null) {
            missing?.let(emit)
            return
        }
        work = executor.submit { operation(owned)?.let { post(token, emit, it) } }
    }

    private fun post(token: Long, emit: (CockpitEvent) -> Unit, event: CockpitEvent) {
        main.post {
            if (synchronized(lock) { token == generation }) emit(event)
        }
    }

    override fun disconnect() {
        synchronized(lock) {
            generation += 1
            work?.cancel(true)
            work = null
            transport?.close()
            transport = null
            pendingPin = null
        }
    }

    fun dispose() {
        disconnect()
        executor.shutdownNow()
    }
}
