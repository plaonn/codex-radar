package dev.codexradar.cockpit.transport

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.jcraft.jsch.Identity
import java.io.ByteArrayOutputStream
import java.math.BigInteger
import java.nio.ByteBuffer
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.util.Base64

private const val ECDSA_P256 = "ecdsa-sha2-nistp256"

private fun sshString(value: ByteArray): ByteArray =
    ByteBuffer.allocate(Int.SIZE_BYTES + value.size).putInt(value.size).put(value).array()

private fun concat(vararg values: ByteArray): ByteArray =
    ByteArrayOutputStream(values.sumOf { it.size }).apply { values.forEach(::write) }.toByteArray()

private fun fixedUnsigned(value: BigInteger, size: Int): ByteArray {
    val source = value.toByteArray().dropWhile { it == 0.toByte() }.toByteArray()
    require(source.size <= size)
    return ByteArray(size - source.size) + source
}

fun ecPublicBlob(key: ECPublicKey): ByteArray {
    val point = byteArrayOf(0x04) +
        fixedUnsigned(key.w.affineX, 32) +
        fixedUnsigned(key.w.affineY, 32)
    return concat(
        sshString(ECDSA_P256.toByteArray(Charsets.US_ASCII)),
        sshString("nistp256".toByteArray(Charsets.US_ASCII)),
        sshString(point),
    )
}

private fun positiveMpInt(value: ByteArray): ByteArray {
    var first = 0
    while (first < value.lastIndex && value[first] == 0.toByte()) first++
    val unsigned = value.copyOfRange(first, value.size)
    return if ((unsigned[0].toInt() and 0x80) != 0) byteArrayOf(0) + unsigned else unsigned
}

private data class DerLength(val value: Int, val next: Int)

private fun derLength(value: ByteArray, offset: Int): DerLength {
    val first = value[offset].toInt() and 0xff
    if ((first and 0x80) == 0) return DerLength(first, offset + 1)
    val count = first and 0x7f
    require(count in 1..2)
    var length = 0
    repeat(count) { length = (length shl 8) or (value[offset + 1 + it].toInt() and 0xff) }
    return DerLength(length, offset + 1 + count)
}

/** Convert Android's DER ECDSA result into RFC 5656's SSH signature blob. */
private fun sshEcdsaSignature(der: ByteArray): ByteArray {
    require(der.isNotEmpty() && der[0] == 0x30.toByte())
    val sequence = derLength(der, 1)
    require(sequence.next + sequence.value == der.size)
    require(der[sequence.next] == 0x02.toByte())
    val rLength = derLength(der, sequence.next + 1)
    val r = der.copyOfRange(rLength.next, rLength.next + rLength.value)
    val sTag = rLength.next + rLength.value
    require(der[sTag] == 0x02.toByte())
    val sLength = derLength(der, sTag + 1)
    val s = der.copyOfRange(sLength.next, sLength.next + sLength.value)
    require(sLength.next + sLength.value == der.size)
    val inner = concat(sshString(positiveMpInt(r)), sshString(positiveMpInt(s)))
    return concat(sshString(ECDSA_P256.toByteArray(Charsets.US_ASCII)), sshString(inner))
}

/** App-generated, non-exportable AndroidKeyStore EC P-256 identity. */
class AndroidKeystoreP256Identity(
    private val profileId: String,
    val alias: String = aliasFor(profileId),
) : Identity {
    init {
        require(alias == aliasFor(profileId))
    }

    fun exists(): Boolean =
        KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.containsAlias(alias)

    /** Explicit profile-creation/recovery action; never called by connection or rendering. */
    fun createKeyPair(): KeyPair {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!store.containsAlias(alias)) {
            val generator = KeyPairGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_EC,
                "AndroidKeyStore",
            )
            generator.initialize(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .setUserAuthenticationRequired(false)
                    .build(),
            )
            generator.generateKeyPair()
        }
        return requireKeyPair(store)
    }

    fun keyPair(): KeyPair {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        check(store.containsAlias(alias)) { "identity_missing" }
        return requireKeyPair(store)
    }

    private fun requireKeyPair(store: KeyStore): KeyPair {
        val privateKey = store.getKey(alias, null) as java.security.PrivateKey
        val publicKey = store.getCertificate(alias).publicKey
        check(privateKey.encoded == null) { "non_exportable_key_required" }
        return KeyPair(publicKey, privateKey)
    }

    fun delete() {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (store.containsAlias(alias)) store.deleteEntry(alias)
    }

    override fun setPassphrase(passphrase: ByteArray?): Boolean = passphrase == null
    override fun getPublicKeyBlob(): ByteArray = ecPublicBlob(keyPair().public as ECPublicKey)
    override fun getSignature(data: ByteArray): ByteArray? = getSignature(data, ECDSA_P256)

    override fun getSignature(data: ByteArray, alg: String): ByteArray? {
        if (alg != ECDSA_P256) return null
        return try {
            val signature = Signature.getInstance("SHA256withECDSA")
            signature.initSign(keyPair().private)
            signature.update(data)
            sshEcdsaSignature(signature.sign())
        } catch (_: Exception) {
            null
        }
    }

    override fun getAlgName(): String = ECDSA_P256
    override fun getName(): String = "codex-radar-android-keystore"
    override fun isEncrypted(): Boolean = false
    override fun clear() = Unit

    /** Public authorization material only. */
    fun openSshPublicKey(): String =
        "$ECDSA_P256 ${Base64.getEncoder().encodeToString(publicKeyBlob)} codex-radar-android"

    companion object {
        fun aliasFor(profileId: String): String = "codex-radar-a3-" +
            MessageDigest.getInstance("SHA-256")
                .digest(profileId.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
                .take(32)
    }
}
