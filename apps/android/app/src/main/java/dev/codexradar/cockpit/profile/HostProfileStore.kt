package dev.codexradar.cockpit.profile

import android.content.Context
import android.content.SharedPreferences
import dev.codexradar.cockpit.domain.HostProfile
import dev.codexradar.cockpit.transport.AndroidKeystoreP256Identity
import java.util.UUID

data class HostKeyPin(val algorithm: String, val sha256: String, val keyBase64: String)

data class PersistedHostProfile(
    val id: String,
    val label: String,
    val host: String,
    val port: Int,
    val user: String,
    val keystoreAlias: String,
    val pin: HostKeyPin? = null,
) {
    init {
        require(id.isNotBlank())
        require(label.isNotBlank())
        require(host.isNotBlank() && !host.any { it.isWhitespace() })
        require(port in 1..65535)
        require(user.isNotBlank() && !user.any { it.isWhitespace() })
        require(keystoreAlias == AndroidKeystoreP256Identity.aliasFor(id))
        pin?.let {
            require(it.algorithm in setOf("ssh-rsa", "ecdsa-sha2-nistp256"))
            require(it.sha256.matches(Regex("SHA256:[A-Za-z0-9+/]+")))
            require(it.keyBase64.matches(Regex("[A-Za-z0-9+/]+={0,2}")))
        }
    }

    fun domainProfile(): HostProfile = HostProfile(label, host, port, user)
}

interface HostProfileStore {
    fun load(): PersistedHostProfile?
    fun create(label: String, host: String, port: Int, user: String): PersistedHostProfile
    fun approvePin(profileId: String, pin: HostKeyPin): PersistedHostProfile
    fun clearPin(profileId: String): PersistedHostProfile
    fun delete(profileId: String)
}

/**
 * One immutable selected-host profile for the MVP. It persists only endpoint,
 * Keystore alias, and reviewed pin metadata; protocol and preview data never enter storage.
 */
class SharedPreferencesHostProfileStore(context: Context) : HostProfileStore {
    private val preferences: SharedPreferences =
        context.getSharedPreferences("host_profile_v1", Context.MODE_PRIVATE)

    override fun load(): PersistedHostProfile? {
        val id = preferences.getString(KEY_ID, null) ?: return null
        return PersistedHostProfile(
            id = id,
            label = requireNotNull(preferences.getString(KEY_LABEL, null)),
            host = requireNotNull(preferences.getString(KEY_HOST, null)),
            port = preferences.getInt(KEY_PORT, 0),
            user = requireNotNull(preferences.getString(KEY_USER, null)),
            keystoreAlias = requireNotNull(preferences.getString(KEY_ALIAS, null)),
            pin = preferences.getString(KEY_PIN_ALGORITHM, null)?.let { algorithm ->
                HostKeyPin(
                    algorithm,
                    requireNotNull(preferences.getString(KEY_PIN_SHA256, null)),
                    requireNotNull(preferences.getString(KEY_PIN_KEY, null)),
                )
            },
        )
    }

    override fun create(label: String, host: String, port: Int, user: String): PersistedHostProfile {
        check(load() == null) { "profile_already_exists" }
        val id = UUID.randomUUID().toString()
        val profile = PersistedHostProfile(
            id = id,
            label = label.trim(),
            host = host.trim(),
            port = port,
            user = user.trim(),
            keystoreAlias = AndroidKeystoreP256Identity.aliasFor(id),
        )
        write(profile)
        return profile
    }

    override fun approvePin(profileId: String, pin: HostKeyPin): PersistedHostProfile {
        val profile = requireProfile(profileId).copy(pin = pin)
        write(profile)
        return profile
    }

    override fun clearPin(profileId: String): PersistedHostProfile {
        val profile = requireProfile(profileId).copy(pin = null)
        write(profile)
        return profile
    }

    override fun delete(profileId: String) {
        requireProfile(profileId)
        check(preferences.edit().clear().commit()) { "profile_delete_failed" }
    }

    private fun requireProfile(profileId: String): PersistedHostProfile =
        requireNotNull(load()).also { check(it.id == profileId) { "profile_identity_mismatch" } }

    private fun write(profile: PersistedHostProfile) {
        val editor = preferences.edit()
            .putString(KEY_ID, profile.id)
            .putString(KEY_LABEL, profile.label)
            .putString(KEY_HOST, profile.host)
            .putInt(KEY_PORT, profile.port)
            .putString(KEY_USER, profile.user)
            .putString(KEY_ALIAS, profile.keystoreAlias)
        if (profile.pin == null) {
            editor.remove(KEY_PIN_ALGORITHM).remove(KEY_PIN_SHA256).remove(KEY_PIN_KEY)
        } else {
            editor.putString(KEY_PIN_ALGORITHM, profile.pin.algorithm)
                .putString(KEY_PIN_SHA256, profile.pin.sha256)
                .putString(KEY_PIN_KEY, profile.pin.keyBase64)
        }
        check(editor.commit()) { "profile_write_failed" }
    }

    private companion object {
        const val KEY_ID = "profile_id"
        const val KEY_LABEL = "label"
        const val KEY_HOST = "host"
        const val KEY_PORT = "port"
        const val KEY_USER = "user"
        const val KEY_ALIAS = "keystore_alias"
        const val KEY_PIN_ALGORITHM = "pin_algorithm"
        const val KEY_PIN_SHA256 = "pin_sha256"
        const val KEY_PIN_KEY = "pin_key"
    }
}
