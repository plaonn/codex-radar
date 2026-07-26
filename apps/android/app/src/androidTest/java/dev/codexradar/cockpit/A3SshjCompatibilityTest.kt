package dev.codexradar.cockpit

import android.os.Bundle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.codexradar.cockpit.a3spike.*
import dev.codexradar.cockpit.protocol.MobileProtocolParser
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyStore
import java.security.Signature
import java.security.interfaces.ECKey
import java.util.Base64

@RunWith(AndroidJUnit4::class)
class A3SshjCompatibilityTest {
    private val arguments: Bundle get() = InstrumentationRegistry.getArguments()
    private val profileId = "a3-disposable-loopback-profile"

    /**
     * Run first to obtain the public key for the disposable sshd authorized_keys.
     * Only public material is emitted; the private key remains non-exportable in Keystore.
     */
    @Test fun prepare_non_exportable_keystore_key() {
        val provider = AndroidKeystoreP256(profileId)
        val pair = provider.keyPair()
        assertNull(pair.private.encoded)
        assertTrue(pair.private is ECKey)
        assertEquals(256, (pair.private as ECKey).params.curve.field.fieldSize)
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        assertTrue(store.containsAlias(provider.alias))
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(pair.private)
        signature.update("a3-keystore-proof".toByteArray())
        assertTrue(signature.sign().isNotEmpty())
        val publicKey = Base64.getEncoder().encodeToString(pair.public.encoded)
        InstrumentationRegistry.getInstrumentation().sendStatus(
            2,
            Bundle().apply { putString("a3_public_key_x509", publicKey) },
        )
    }

    @Test fun sshj_keystore_pin_exec_protocol_reconnect_and_cleanup() {
        val host = arguments.getString("a3_host")
        val port = arguments.getString("a3_port")?.toIntOrNull()
        val user = arguments.getString("a3_user")
        assumeTrue("disposable sshd arguments required", host != null && port != null && user != null)
        val base = SpikeHostProfile(profileId, host!!, port!!, user!!)

        val discoveryTransport = SshjRadarSpike()
        val review = discoveryTransport.connect(base)
        assertTrue("unknown host did not reach review boundary: $review", review is SpikeResult.HostReviewRequired)
        val presented = (review as SpikeResult.HostReviewRequired).presented

        val pinned = base.copy(
            pinnedAlgorithm = presented.algorithm,
            pinnedSha256 = presented.sha256,
        )
        val first = SshjRadarSpike()
        val connected = first.connect(pinned)
        assertTrue("SSHJ/Keystore connection failed: $connected", connected is SpikeResult.Connected)
        val sessions = MobileProtocolParser.parseSessions(
            (connected as SpikeResult.Connected).state.getJSONArray("sessions"),
        )
        assertTrue(sessions.isNotEmpty())
        first.onBackground()

        val reconnect = SshjRadarSpike()
        assertTrue(reconnect.connect(pinned) is SpikeResult.Connected)
        reconnect.close()

        val mismatch = SshjRadarSpike().connect(pinned.copy(pinnedSha256 = "SHA256:changed"))
        assertEquals(SpikeResult.Failed("host_key_mismatch"), mismatch)
    }
}
