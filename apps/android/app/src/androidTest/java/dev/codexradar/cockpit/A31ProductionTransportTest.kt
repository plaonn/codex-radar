package dev.codexradar.cockpit

import android.os.Bundle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.codexradar.cockpit.profile.PersistedHostProfile
import dev.codexradar.cockpit.protocol.MobileProtocolParser
import dev.codexradar.cockpit.protocol.ForegroundSshProtocolClient
import dev.codexradar.cockpit.domain.CockpitEvent
import dev.codexradar.cockpit.transport.AndroidKeystoreP256Identity
import dev.codexradar.cockpit.transport.JschForegroundTransport
import dev.codexradar.cockpit.transport.TransportConnectResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyStore
import java.security.Signature
import java.security.interfaces.ECKey
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class A31ProductionTransportTest {
    private val arguments: Bundle get() = InstrumentationRegistry.getArguments()
    private val profileId = "a31-disposable-loopback-profile"
    private val alias = AndroidKeystoreP256Identity.aliasFor(profileId)

    @Test fun prepare_non_exportable_keystore_key() {
        val provider = AndroidKeystoreP256Identity(profileId, alias)
        val pair = provider.createKeyPair()
        assertNull(pair.private.encoded)
        assertTrue(pair.private is ECKey)
        assertEquals(256, (pair.private as ECKey).params.curve.field.fieldSize)
        assertTrue(
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.containsAlias(alias),
        )
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(pair.private)
        signature.update("a31-keystore-proof".toByteArray())
        assertTrue(signature.sign().isNotEmpty())
        val publicOnly = provider.openSshPublicKey()
        assertTrue(publicOnly.startsWith("ecdsa-sha2-nistp256 "))
        assertFalse(publicOnly.contains(profileId))
        assertFalse(publicOnly.contains("PRIVATE"))
        InstrumentationRegistry.getInstrumentation().sendStatus(
            2,
            Bundle().apply { putString("a31_public_key_openssh", publicOnly) },
        )
    }

    @Test fun production_pin_exec_protocol_reconnect_and_cleanup() {
        val host = arguments.getString("a31_host")
        val port = arguments.getString("a31_port")?.toIntOrNull()
        val lossPort = arguments.getString("a31_loss_port")?.toIntOrNull()
        val user = arguments.getString("a31_user")
        assumeTrue(
            "disposable sshd arguments required",
            host != null && port != null && lossPort != null && user != null,
        )
        val base = PersistedHostProfile(
            profileId,
            "Disposable loopback",
            host!!,
            port!!,
            user!!,
            alias,
        )

        val review = JschForegroundTransport().connect(base)
        assertTrue("unknown host did not reach review boundary: $review", review is TransportConnectResult.HostReviewRequired)
        val pinned = base.copy(pin = (review as TransportConnectResult.HostReviewRequired).presented.pin())

        val first = JschForegroundTransport()
        val connected = first.connect(pinned)
        assertTrue("production JSch connection failed: $connected", connected is TransportConnectResult.Connected)
        val sessions = MobileProtocolParser.parseSessions(
            (connected as TransportConnectResult.Connected).state.getJSONArray("sessions"),
        )
        assertTrue(sessions.isNotEmpty())
        val preview = first.readPreview(sessions.first().id.value, 20)
        assertEquals("codex-radar.transcript-preview", preview.getString("contract"))
        assertTrue(preview.getJSONArray("messages").length() > 0)
        // connect already consumed and discarded the fresh baseline
        assertTrue(first.pollAttention().events.isEmpty())
        assertTrue(first.requestRemoteShutdown())
        assertTrue(first.awaitAutomaticClose(5_000))
        assertEquals("remote_eof", first.terminalFailureCode())

        val reconnect = JschForegroundTransport()
        assertTrue(reconnect.connect(pinned) is TransportConnectResult.Connected)
        assertTrue(reconnect.pollAttention().events.isEmpty())
        reconnect.close()
        assertTrue(reconnect.awaitAutomaticClose(1_000))
        assertNull(reconnect.terminalFailureCode())

        val mismatch = JschForegroundTransport().connect(
            pinned.copy(pin = requireNotNull(pinned.pin).copy(sha256 = "SHA256:Y2hhbmdlZA")),
        )
        assertEquals(TransportConnectResult.Failed("host_key_mismatch"), mismatch)

        fun pinnedAt(otherPort: Int): PersistedHostProfile {
            val candidate = base.copy(port = otherPort, pin = null)
            val candidateReview = JschForegroundTransport().connect(candidate)
            assertTrue(candidateReview is TransportConnectResult.HostReviewRequired)
            return candidate.copy(
                pin = (candidateReview as TransportConnectResult.HostReviewRequired).presented.pin(),
            )
        }

        arguments.getString("a31_auth_port")?.toIntOrNull()?.let { authPort ->
            assertEquals(
                TransportConnectResult.Failed("authentication_failed"),
                JschForegroundTransport().connect(pinnedAt(authPort)),
            )
        }
        arguments.getString("a31_process_port")?.toIntOrNull()?.let { processPort ->
            assertEquals(
                TransportConnectResult.Failed("process_launch_failed"),
                JschForegroundTransport().connect(pinnedAt(processPort)),
            )
        }
        arguments.getString("a31_protocol_port")?.toIntOrNull()?.let { protocolPort ->
            assertEquals(
                TransportConnectResult.Failed("protocol_failed"),
                JschForegroundTransport().connect(pinnedAt(protocolPort)),
            )
        }
        arguments.getString("a31_immediate_port")?.toIntOrNull()?.let { immediatePort ->
            val immediateEvents = CopyOnWriteArrayList<CockpitEvent>()
            val immediateFailed = CountDownLatch(1)
            val immediate = ForegroundSshProtocolClient(pinnedAt(immediatePort))
            immediate.connect {
                immediateEvents += it
                if (it is CockpitEvent.Failed) immediateFailed.countDown()
            }
            assertTrue(immediateFailed.await(5, TimeUnit.SECONDS))
            Thread.sleep(250)
            assertTrue(immediateEvents.last() is CockpitEvent.Failed)
            immediate.dispose()
        }

        val lossBase = base.copy(port = lossPort!!)
        val lossReview = JschForegroundTransport().connect(lossBase)
        assertTrue(lossReview is TransportConnectResult.HostReviewRequired)
        val lossPinned = lossBase.copy(
            pin = (lossReview as TransportConnectResult.HostReviewRequired).presented.pin(),
        )
        val events = CopyOnWriteArrayList<CockpitEvent>()
        val connectedLatch = CountDownLatch(1)
        val failedLatch = CountDownLatch(1)
        val client = ForegroundSshProtocolClient(lossPinned)
        client.connect {
            events += it
            if (it is CockpitEvent.Connected) connectedLatch.countDown()
            if (it is CockpitEvent.Failed) failedLatch.countDown()
        }
        assertTrue(connectedLatch.await(5, TimeUnit.SECONDS))
        assertTrue(failedLatch.await(5, TimeUnit.SECONDS))
        assertEquals("ssh_disconnected", (events.last() as CockpitEvent.Failed).code)
        client.dispose()
    }
}
