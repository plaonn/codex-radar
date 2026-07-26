package dev.codexradar.cockpit

import android.content.Context
import android.os.Bundle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.codexradar.cockpit.profile.SharedPreferencesHostProfileStore
import dev.codexradar.cockpit.transport.AndroidKeystoreP256Identity
import dev.codexradar.cockpit.transport.JschForegroundTransport
import dev.codexradar.cockpit.transport.TransportConnectResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class A5PhysicalDeviceSmokeTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val arguments: Bundle get() = InstrumentationRegistry.getArguments()
    private val context: Context get() = instrumentation.targetContext

    @Test fun same_signature_replace_preserves_profile_pin_identity_and_reconnects() {
        assumeTrue(arguments.getString("a5_replace_expected") == "true")
        val profile = requireNotNull(SharedPreferencesHostProfileStore(context).load())
        assertNotNull(profile.pin)
        val identity = AndroidKeystoreP256Identity(profile.id, profile.keystoreAlias)
        assertTrue(identity.exists())
        assertEquals(null, identity.keyPair().private.encoded)
        assertTrue(identity.openSshPublicKey().startsWith("ecdsa-sha2-nistp256 "))

        val transport = JschForegroundTransport()
        try {
            assertTrue(transport.connect(profile) is TransportConnectResult.Connected)
        } finally {
            transport.close()
        }
    }

    @Test fun remote_eof_closes_channel_without_raw_detail() {
        val eofPort = arguments.getString("a5_eof_port")?.toIntOrNull()
        assumeTrue(arguments.getString("a5_remote_eof") == "true" && eofPort != null)
        val profile = requireNotNull(SharedPreferencesHostProfileStore(context).load())
            .copy(port = eofPort!!)
        val transport = JschForegroundTransport()
        assertTrue(transport.connect(profile) is TransportConnectResult.Connected)
        assertTrue(transport.awaitAutomaticClose(15_000))
        assertEquals("remote_eof", transport.terminalFailureCode())
        transport.close()
    }

    @Test fun forced_ssh_loss_closes_channel_with_sanitized_failure() {
        assumeTrue(arguments.getString("a5_forced_loss") == "true")
        val profile = requireNotNull(SharedPreferencesHostProfileStore(context).load())
        val terminalCodes = mutableListOf<String>()
        val transport = JschForegroundTransport { terminalCodes.add(it) }
        assertTrue(transport.connect(profile) is TransportConnectResult.Connected)
        instrumentation.sendStatus(
            2,
            Bundle().apply { putString("a5_step", "connected_forced_loss") },
        )
        assertTrue(transport.awaitAutomaticClose(15_000))
        assertEquals("ssh_disconnected", transport.terminalFailureCode())
        assertEquals(listOf("ssh_disconnected"), terminalCodes)
        assertFalse(terminalCodes.single().contains("/") || terminalCodes.single().contains(":"))
        transport.close()
    }

    @Test fun cleanup_profile_and_identity() {
        assumeTrue(arguments.getString("a5_cleanup") == "true")
        val store = SharedPreferencesHostProfileStore(context)
        val profile = requireNotNull(store.load())
        val identity = AndroidKeystoreP256Identity(profile.id, profile.keystoreAlias)
        store.delete(profile.id)
        identity.delete()
        assertEquals(null, store.load())
        assertFalse(identity.exists())
    }
}
