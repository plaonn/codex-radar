package dev.codexradar.cockpit.a3spike

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import net.schmizz.sshj.DefaultSecurityProviderConfig
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.common.Buffer
import net.schmizz.sshj.common.KeyType
import net.schmizz.sshj.common.SecurityUtils
import net.schmizz.sshj.connection.channel.direct.Session
import net.schmizz.sshj.transport.kex.ECDHNistP
import net.schmizz.sshj.transport.verification.HostKeyVerifier
import net.schmizz.sshj.userauth.keyprovider.KeyProvider
import org.json.JSONObject
import java.io.Closeable
import java.io.InputStream
import java.io.OutputStream
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PublicKey
import java.util.Base64

const val MAX_JSONL_FRAME_BYTES = 1_048_576
const val RADAR_COMMAND = "codex-radar mobile rpc"

data class SpikeHostProfile(
    val id: String,
    val host: String,
    val port: Int,
    val user: String,
    val pinnedAlgorithm: String? = null,
    val pinnedSha256: String? = null,
)

data class PresentedHostKey(val algorithm: String, val sha256: String)

/** Exact-pin verifier. Unknown and changed keys both stop key exchange before authentication. */
class ExactHostKeyVerifier(private val profile: SpikeHostProfile) : HostKeyVerifier {
    @Volatile var presented: PresentedHostKey? = null
        private set

    override fun verify(hostname: String, port: Int, key: PublicKey): Boolean {
        val identity = PresentedHostKey(KeyType.fromKey(key).toString(), sshSha256(key))
        presented = identity
        return hostname == profile.host &&
            port == profile.port &&
            profile.pinnedAlgorithm == identity.algorithm &&
            profile.pinnedSha256 == identity.sha256
    }

    override fun findExistingAlgorithms(hostname: String, port: Int): List<String> =
        if (hostname == profile.host && port == profile.port && profile.pinnedAlgorithm != null) {
            listOf(profile.pinnedAlgorithm)
        } else {
            emptyList()
        }

    companion object {
        fun sshSha256(key: PublicKey): String {
            val blob = Buffer.PlainBuffer().putPublicKey(key).compactData
            val digest = MessageDigest.getInstance("SHA-256").digest(blob)
            return "SHA256:" + Base64.getEncoder().withoutPadding().encodeToString(digest)
        }
    }
}

/** One non-exportable AndroidKeyStore P-256 key, deterministically owned by immutable profile id. */
class AndroidKeystoreP256(private val profileId: String) : KeyProvider {
    val alias: String = "codex-radar-a3-" + MessageDigest.getInstance("SHA-256")
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

    override fun getPrivate(): java.security.PrivateKey = keyPair().private
    override fun getPublic(): PublicKey = keyPair().public
    override fun getType(): KeyType = KeyType.ECDSA256
}

class ProtocolViolation(val code: String) : Exception(code)

/**
 * Strict JSONL request/response boundary. It validates a complete frame before exposing it,
 * and any framing/id/version violation poisons this session.
 */
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
        val bytes = java.io.ByteArrayOutputStream(minOf(4096, maxBytes))
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

/**
 * Compatibility-spike transport only. It is intentionally not wired into MainActivity.
 * Calling close on background/disconnect closes command, session, and SSH in ownership order.
 */
class SshjRadarSpike : Closeable {
    private var ssh: SSHClient? = null
    private var session: Session? = null
    private var command: Session.Command? = null
    private var protocol: BoundedJsonlSession? = null

    fun connect(profile: SpikeHostProfile): SpikeResult {
        close()
        val verifier = ExactHostKeyVerifier(profile)
        var stage = "host"
        return try {
            // This SSHJ config disables forced BC selection before crypto initialization.
            // Android/JCA can then route this non-exportable key to its owning Keystore provider.
            val config = DefaultSecurityProviderConfig()
            if (SecurityUtils.getSecurityProvider() != null) {
                return SpikeResult.Failed("provider_conflict")
            }
            // Android's default JCA provider does not expose SSHJ's Curve25519 primitive.
            // Keep the spike on the standard, host-supported ECDH P-256 exchange.
            config.keyExchangeFactories = listOf(ECDHNistP.Factory256())
            val client = SSHClient(config)
            ssh = client
            client.addHostKeyVerifier(verifier)
            client.connect(profile.host, profile.port)
            if (profile.pinnedAlgorithm == null || profile.pinnedSha256 == null) {
                close()
                return SpikeResult.HostReviewRequired(
                    verifier.presented ?: return SpikeResult.Failed("host_key_unavailable"),
                )
            }
            val key = AndroidKeystoreP256(profile.id)
            stage = "authentication"
            client.authPublickey(profile.user, key)
            stage = "process"
            val ownedSession = client.startSession()
            session = ownedSession
            val ownedCommand = ownedSession.exec(RADAR_COMMAND)
            command = ownedCommand
            val ownedProtocol = BoundedJsonlSession(ownedCommand.inputStream, ownedCommand.outputStream)
            protocol = ownedProtocol
            stage = "protocol"
            SpikeResult.Connected(ownedProtocol.initializeAndReadState())
        } catch (_: ProtocolViolation) {
            close()
            SpikeResult.Failed("protocol_failed")
        } catch (_: Exception) {
            val unknown = profile.pinnedAlgorithm == null || profile.pinnedSha256 == null
            val presented = verifier.presented
            close()
            if (unknown && presented != null) SpikeResult.HostReviewRequired(presented)
            else if (
                presented != null &&
                (profile.pinnedAlgorithm != presented.algorithm || profile.pinnedSha256 != presented.sha256)
            ) {
                SpikeResult.Failed("host_key_mismatch")
            } else {
                SpikeResult.Failed(
                    when (stage) {
                        "authentication" -> "authentication_failed"
                        "process" -> "process_launch_failed"
                        "protocol" -> "protocol_failed"
                        else -> "ssh_connection_failed"
                    },
                )
            }
        }
    }

    fun onBackground() = close()

    override fun close() {
        protocol?.close()
        runCatching { command?.close() }
        runCatching { session?.close() }
        runCatching { ssh?.disconnect() }
        runCatching { ssh?.close() }
        protocol = null
        command = null
        session = null
        ssh = null
    }
}
