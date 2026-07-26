package dev.codexradar.cockpit.a3spike

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.jcraft.jsch.ChannelExec
import com.jcraft.jsch.HostKey
import com.jcraft.jsch.HostKeyRepository
import com.jcraft.jsch.Identity
import com.jcraft.jsch.IdentityRepository
import com.jcraft.jsch.JSch
import com.jcraft.jsch.Session
import com.jcraft.jsch.UserInfo
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.InputStream
import java.io.OutputStream
import java.math.BigInteger
import java.nio.ByteBuffer
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.util.Base64
import java.util.Vector
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

const val MAX_JSONL_FRAME_BYTES = 1_048_576
const val RADAR_COMMAND = "codex-radar mobile rpc"
private const val ECDSA_P256 = "ecdsa-sha2-nistp256"

data class SpikeHostProfile(
    val id: String,
    val host: String,
    val port: Int,
    val user: String,
    val pinnedAlgorithm: String? = null,
    val pinnedSha256: String? = null,
)

data class PresentedHostKey(val algorithm: String, val sha256: String)

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

/** One app-generated, non-exportable AndroidKeyStore P-256 identity. */
class AndroidKeystoreP256(private val profileId: String) : Identity {
    val alias: String = "codex-radar-a3f-" + MessageDigest.getInstance("SHA-256")
        .digest(profileId.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
        .take(32)

    fun keyPair(): KeyPair {
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
        val privateKey = store.getKey(alias, null) as java.security.PrivateKey
        val publicKey = store.getCertificate(alias).publicKey
        check(privateKey.encoded == null) { "non_exportable_key_required" }
        return KeyPair(publicKey, privateKey)
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

    /** Public authorization material only; private and profile material are never included. */
    fun openSshPublicKey(): String =
        "$ECDSA_P256 ${Base64.getEncoder().encodeToString(publicKeyBlob)} codex-radar-android"
}

private class SingleIdentityRepository(private val identity: Identity) : IdentityRepository {
    override fun getName(): String = "android-keystore-only"
    override fun getStatus(): Int = IdentityRepository.RUNNING
    override fun getIdentities(): Vector<Identity> = Vector<Identity>().apply { add(identity) }
    override fun add(identity: ByteArray?): Boolean = false
    override fun remove(blob: ByteArray?): Boolean = false
    override fun removeAll() = Unit
}

/**
 * Memory-only exact-pin repository. Unknown and changed keys are rejected by
 * StrictHostKeyChecking before JSch begins user authentication.
 */
class ExactHostKeyRepository(private val profile: SpikeHostProfile) : HostKeyRepository {
    @Volatile var presented: PresentedHostKey? = null
        private set

    override fun check(host: String, key: ByteArray): Int {
        val current = PresentedHostKey(
            algorithm = HostKey(host, key).type,
            sha256 = sshSha256(key),
        )
        presented = current
        if (profile.pinnedAlgorithm == null || profile.pinnedSha256 == null) {
            return HostKeyRepository.NOT_INCLUDED
        }
        return if (
            current.algorithm == profile.pinnedAlgorithm &&
            current.sha256 == profile.pinnedSha256
        ) {
            HostKeyRepository.OK
        } else {
            HostKeyRepository.CHANGED
        }
    }

    override fun add(hostkey: HostKey?, ui: UserInfo?) = Unit
    override fun remove(host: String?, type: String?) = Unit
    override fun remove(host: String?, type: String?, key: ByteArray?) = Unit
    override fun getKnownHostsRepositoryID(): String = "memory-exact-pin"
    override fun getHostKey(): Array<HostKey> = emptyArray()
    override fun getHostKey(host: String?, type: String?): Array<HostKey> = emptyArray()

    companion object {
        fun sshSha256(blob: ByteArray): String {
            val digest = MessageDigest.getInstance("SHA-256").digest(blob)
            return "SHA256:" + Base64.getEncoder().withoutPadding().encodeToString(digest)
        }
    }
}

class ProtocolViolation(val code: String) : Exception(code)

/** Strict JSONL boundary: validate a complete bounded frame before exposing it. */
class BoundedJsonlSession(
    private val input: InputStream,
    private val output: OutputStream,
    private val maxBytes: Int = MAX_JSONL_FRAME_BYTES,
) : Closeable {
    private var failed = false
    private var nextId = 1
    private val responseIds = mutableSetOf<Int>()

    fun initializeAndReadState(): JSONObject {
        val initialized = call(
            "initialize",
            JSONObject()
                .put("protocol_versions", org.json.JSONArray().put(1))
                .put("preview_contract_versions", org.json.JSONArray().put(1).put(2)),
        )
        if (
            initialized.optString("protocol") != "codex-radar.read-protocol" ||
            initialized.optInt("version", -1) != 1 ||
            initialized.optInt("preview_contract_version", -1) !in 1..2 ||
            initialized.optString("attention_delivery") != "foreground-poll"
        ) fail("protocol_incompatible")
        val state = call("state/read")
        if (
            state.optString("contract") != "codex-radar.display-state" ||
            state.optInt("version", -1) != 1
        ) fail("protocol_incompatible")
        return state
    }

    fun call(method: String, params: JSONObject? = null): JSONObject {
        if (failed) throw ProtocolViolation("connection_invalid")
        val id = nextId++
        val request = JSONObject().put("id", id).put("method", method)
        if (params != null) request.put("params", params)
        writeFrame(request.toString())
        val response = readFrame()
        val responseId = response.optInt("id", Int.MIN_VALUE)
        if (responseId == Int.MIN_VALUE || !responseIds.add(responseId)) fail("duplicate_response_id")
        if (responseId != id) fail("unexpected_response_id")
        if (response.has("error")) fail("remote_protocol_error")
        return response.optJSONObject("result") ?: fail("malformed_response")
    }

    fun writeFrame(value: String) {
        if (failed) throw ProtocolViolation("connection_invalid")
        val bytes = value.toByteArray(Charsets.UTF_8)
        if (bytes.size > maxBytes) fail("frame_too_large")
        output.write(bytes)
        output.write('\n'.code)
        output.flush()
    }

    fun readFrame(): JSONObject {
        if (failed) throw ProtocolViolation("connection_invalid")
        val bytes = ByteArrayOutputStream(minOf(4096, maxBytes))
        while (true) {
            val value = input.read()
            if (value == -1) fail("unexpected_eof")
            if (value == '\n'.code) break
            if (bytes.size() == maxBytes) fail("frame_too_large")
            bytes.write(value)
        }
        if (bytes.size() == 0) fail("malformed_frame")
        return try {
            JSONObject(bytes.toByteArray().toString(Charsets.UTF_8))
        } catch (_: Exception) {
            fail("malformed_frame")
        }
    }

    private fun fail(code: String): Nothing {
        failed = true
        throw ProtocolViolation(code)
    }

    override fun close() {
        failed = true
        runCatching { output.close() }
        runCatching { input.close() }
    }
}

sealed class SpikeResult {
    data class HostReviewRequired(val presented: PresentedHostKey) : SpikeResult()
    data class Connected(val state: JSONObject) : SpikeResult()
    data class Failed(val code: String) : SpikeResult()
}

/** Owns remote EOF/loss termination and a bounded, discarded stderr drain. */
class PostConnectLifecycle(
    private val closeOwnedResources: () -> Unit,
    private val maxDiagnosticBytes: Int = 8_192,
) {
    private val terminated = AtomicBoolean(false)
    private val closed = CountDownLatch(1)
    @Volatile private var terminalCode: String? = null

    fun remoteEnded() = terminate("remote_eof")
    fun sshLost() = terminate("ssh_disconnected")

    fun drainStderr(input: InputStream): Thread = Thread {
        var total = 0
        val buffer = ByteArray(1_024)
        try {
            while (!terminated.get()) {
                val count = input.read(buffer)
                if (count < 0) return@Thread
                total += count
                if (total > maxDiagnosticBytes) {
                    terminate("diagnostic_too_large")
                    return@Thread
                }
            }
        } catch (_: Exception) {
            if (!terminated.get()) sshLost()
        }
    }.apply {
        name = "codex-radar-a3f-stderr"
        isDaemon = true
        start()
    }

    fun explicitClose() {
        if (terminated.compareAndSet(false, true)) {
            closeOwnedResources()
            closed.countDown()
        }
    }

    fun awaitClosed(timeoutMillis: Long): Boolean =
        closed.await(timeoutMillis, TimeUnit.MILLISECONDS)

    fun failureCode(): String? = terminalCode

    private fun terminate(code: String) {
        if (terminated.compareAndSet(false, true)) {
            terminalCode = code
            closeOwnedResources()
            closed.countDown()
        }
    }
}

/**
 * mwiede/jsch fallback spike only. It is intentionally not wired into MainActivity.
 * One foreground connection owns one non-PTY exact-command channel.
 */
class JschRadarSpike : Closeable {
    private var session: Session? = null
    private var command: ChannelExec? = null
    private var protocol: BoundedJsonlSession? = null
    private var lifecycle: PostConnectLifecycle? = null

    fun connect(profile: SpikeHostProfile): SpikeResult {
        close()
        lifecycle = null
        val repository = ExactHostKeyRepository(profile)
        var stage = "host"
        return try {
            val identity = AndroidKeystoreP256(profile.id)
            val jsch = JSch().apply {
                setIdentityRepository(SingleIdentityRepository(identity))
                setHostKeyRepository(repository)
            }
            val ownedSession = jsch.getSession(profile.user, profile.host, profile.port).apply {
                setConfig("StrictHostKeyChecking", "yes")
                setConfig("PreferredAuthentications", "publickey")
                setConfig("FingerprintHash", "sha-256")
            }
            session = ownedSession
            stage = "authentication"
            ownedSession.connect(10_000)

            val ownedCommand = ownedSession.openChannel("exec") as ChannelExec
            command = ownedCommand
            ownedCommand.setPty(false)
            ownedCommand.setCommand(RADAR_COMMAND)
            val ownedLifecycle = PostConnectLifecycle(::releaseOwnedResources)
            lifecycle = ownedLifecycle
            // Start draining before exec/channel connect so remote diagnostics cannot block startup.
            ownedLifecycle.drainStderr(ownedCommand.extInputStream)
            stage = "process"
            ownedCommand.connect(10_000)

            val ownedProtocol = BoundedJsonlSession(
                ownedCommand.inputStream,
                ownedCommand.outputStream,
            )
            protocol = ownedProtocol
            stage = "protocol"
            val state = ownedProtocol.initializeAndReadState()
            Thread {
                while (!ownedCommand.isClosed && ownedSession.isConnected) {
                    try {
                        Thread.sleep(25)
                    } catch (_: InterruptedException) {
                        ownedLifecycle.sshLost()
                        return@Thread
                    }
                }
                if (ownedSession.isConnected) ownedLifecycle.remoteEnded()
                else ownedLifecycle.sshLost()
            }.apply {
                name = "codex-radar-a3f-command"
                isDaemon = true
                start()
            }
            SpikeResult.Connected(state)
        } catch (_: ProtocolViolation) {
            close()
            SpikeResult.Failed("protocol_failed")
        } catch (_: Exception) {
            val unknown = profile.pinnedAlgorithm == null || profile.pinnedSha256 == null
            val presented = repository.presented
            close()
            if (unknown && presented != null) {
                SpikeResult.HostReviewRequired(presented)
            } else if (
                presented != null &&
                (profile.pinnedAlgorithm != presented.algorithm ||
                    profile.pinnedSha256 != presented.sha256)
            ) {
                SpikeResult.Failed("host_key_mismatch")
            } else {
                SpikeResult.Failed(
                    when (stage) {
                        "authentication" -> if (presented == null) {
                            "ssh_connection_failed"
                        } else {
                            "authentication_failed"
                        }
                        "process" -> "process_launch_failed"
                        "protocol" -> "protocol_failed"
                        else -> "ssh_connection_failed"
                    },
                )
            }
        }
    }

    fun onBackground() = close()

    fun requestRemoteShutdown(): Boolean = try {
        protocol?.call("shutdown")?.optBoolean("shutdown") == true
    } catch (_: Exception) {
        false
    }

    fun awaitAutomaticClose(timeoutMillis: Long): Boolean =
        lifecycle?.awaitClosed(timeoutMillis) ?: false

    fun terminalFailureCode(): String? = lifecycle?.failureCode()

    override fun close() {
        val ownedLifecycle = lifecycle
        if (ownedLifecycle != null) {
            ownedLifecycle.explicitClose()
            return
        }
        releaseOwnedResources()
    }

    private fun releaseOwnedResources() {
        protocol?.close()
        runCatching { command?.disconnect() }
        runCatching { session?.disconnect() }
        protocol = null
        command = null
        session = null
    }
}
