package dev.codexradar.cockpit

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.codexradar.cockpit.profile.HostKeyPin
import dev.codexradar.cockpit.profile.SharedPreferencesHostProfileStore
import dev.codexradar.cockpit.transport.AndroidKeystoreP256Identity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyStore

@RunWith(AndroidJUnit4::class)
class ProfileIdentityTest {
    @Test fun profile_persists_exact_pin_and_key_is_non_exportable_then_deleted() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.getSharedPreferences("host_profile_v1", 0).edit().clear().commit()
        val store = SharedPreferencesHostProfileStore(context)
        val profile = store.create("Loopback", "127.0.0.1", 2222, "radar")
        val identity = AndroidKeystoreP256Identity(profile.id, profile.keystoreAlias)
        val pair = identity.createKeyPair()
        assertNull(pair.private.encoded)
        assertTrue(identity.openSshPublicKey().startsWith("ecdsa-sha2-nistp256 "))

        val pin = HostKeyPin("ssh-rsa", "SHA256:YWJj", "YWJj")
        assertEquals(pin, store.approvePin(profile.id, pin).pin)
        assertEquals(pin, store.load()?.pin)
        assertNull(store.clearPin(profile.id).pin)

        identity.delete()
        store.delete(profile.id)
        assertFalse(
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                .containsAlias(profile.keystoreAlias),
        )
        assertNull(store.load())
    }

    @Test fun missing_restored_identity_never_regenerates_implicitly() {
        val id = "restored-profile-without-key"
        val identity = AndroidKeystoreP256Identity(id)
        identity.delete()
        assertFalse(identity.exists())
        val error = runCatching { identity.keyPair() }.exceptionOrNull()
        assertEquals("identity_missing", error?.message)
        assertFalse(identity.exists())
        identity.createKeyPair()
        assertTrue(identity.exists())
        identity.delete()
    }
}
