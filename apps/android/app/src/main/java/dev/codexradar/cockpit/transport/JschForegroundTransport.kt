package dev.codexradar.cockpit.transport

import com.jcraft.jsch.ChannelExec
import com.jcraft.jsch.HostKey
import com.jcraft.jsch.HostKeyRepository
import com.jcraft.jsch.Identity
import com.jcraft.jsch.IdentityRepository
import com.jcraft.jsch.JSch
import com.jcraft.jsch.JSchAlgoNegoFailException
import com.jcraft.jsch.Session
import com.jcraft.jsch.UserInfo
import dev.codexradar.cockpit.profile.HostKeyPin
import dev.codexradar.cockpit.profile.PersistedHostProfile
import dev.codexradar.cockpit.protocol.BoundedJsonlSession
import dev.codexradar.cockpit.protocol.ProtocolViolation
import dev.codexradar.cockpit.protocol.PollStateResult
import dev.codexradar.cockpit.protocol.RemoteMethodError
import dev.codexradar.cockpit.protocol.RpcCallResult
import org.json.JSONObject
import java.io.Closeable
import java.io.InputStream
import java.security.MessageDigest
import java.util.Base64
import java.util.Vector
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

const val RADAR_COMMAND = "codex-radar mobile rpc"
const val SUPPORTED_SERVER_HOST_KEYS =
    "rsa-sha2-512,rsa-sha2-256,ecdsa-sha2-nistp256"

data class PresentedHostKey(
    val algorithm: String,
    val sha256: String,
    val keyBase64: String,
) {
    fun pin(): HostKeyPin = HostKeyPin(algorithm, sha256, keyBase64)
}

private class SingleIdentityRepository(private val identity: Identity) : IdentityRepository {
    override fun getName(): String = "android-keystore-only"
    override fun getStatus(): Int = IdentityRepository.RUNNING
    override fun getIdentities(): Vector<Identity> = Vector<Identity>().apply { add(identity) }
    override fun add(identity: ByteArray?): Boolean = false
    override fun remove(blob: ByteArray?): Boolean = false
    override fun removeAll() = Unit
}

/** Session-local exact host-key repository; unknown and changed keys fail before auth. */
class ExactHostKeyRepository(private val profile: PersistedHostProfile) : HostKeyRepository {
    @Volatile var presented: PresentedHostKey? = null
        private set

    override fun check(host: String, key: ByteArray): Int {
        val current = PresentedHostKey(
            algorithm = HostKey(host, key).type,
            sha256 = sshSha256(key),
            keyBase64 = Base64.getEncoder().encodeToString(key),
        )
        presented = current
        val pin = profile.pin ?: return HostKeyRepository.NOT_INCLUDED
        return if (
            current.algorithm == pin.algorithm &&
            current.sha256 == pin.sha256 &&
            MessageDigest.isEqual(
                current.keyBase64.toByteArray(Charsets.US_ASCII),
                pin.keyBase64.toByteArray(Charsets.US_ASCII),
            )
        ) {
            HostKeyRepository.OK
        } else {
            HostKeyRepository.CHANGED
        }
    }

    override fun add(hostkey: HostKey?, ui: UserInfo?) = Unit
    override fun remove(host: String?, type: String?) = Unit
    override fun remove(host: String?, type: String?, key: ByteArray?) = Unit
    override fun getKnownHostsRepositoryID(): String = "profile-exact-pin"
    override fun getHostKey(): Array<HostKey> = emptyArray()
    override fun getHostKey(host: String?, type: String?): Array<HostKey> = emptyArray()

    companion object {
        fun sshSha256(blob: ByteArray): String {
            val digest = MessageDigest.getInstance("SHA-256").digest(blob)
            return "SHA256:" + Base64.getEncoder().withoutPadding().encodeToString(digest)
        }
    }
}

/** Idempotent resource close owner plus bounded, discarded stderr drain. */
class PostConnectLifecycle(
    private val closeOwnedResources: () -> Unit,
    private val maxDiagnosticBytes: Int = 8_192,
    private val terminalListener: (String) -> Unit = {},
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
        name = "codex-radar-stderr"
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
            terminalListener(code)
        }
    }
}

sealed class TransportConnectResult {
    data class HostReviewRequired(val presented: PresentedHostKey) : TransportConnectResult()
    data class Connected(val state: JSONObject) : TransportConnectResult()
    data class Failed(val code: String) : TransportConnectResult()
}

enum class ConnectStage { SSH, PROCESS, PROTOCOL }

fun classifyConnectFailure(
    stage: ConnectStage,
    presented: PresentedHostKey?,
    profile: PersistedHostProfile,
    exception: Exception,
): TransportConnectResult.Failed = when {
    exception is IllegalStateException && exception.message == "identity_missing" ->
        TransportConnectResult.Failed("identity_missing")
    profile.pin != null && presented != null && presented.pin() != profile.pin ->
        TransportConnectResult.Failed("host_key_mismatch")
    exception is JSchAlgoNegoFailException && exception.algorithmName == "server_host_key" ->
        TransportConnectResult.Failed("unsupported_host_key")
    stage == ConnectStage.SSH && presented != null ->
        TransportConnectResult.Failed("authentication_failed")
    stage == ConnectStage.SSH -> TransportConnectResult.Failed("ssh_connection_failed")
    stage == ConnectStage.PROCESS -> TransportConnectResult.Failed("process_launch_failed")
    else -> TransportConnectResult.Failed("protocol_failed")
}

fun validateAttentionPoll(result: RpcCallResult): RpcCallResult {
    val raw = result.result.opt("events_emitted")
    val count = (raw as? Number)?.toLong()
    if (
        count == null || count < 0 || count > Int.MAX_VALUE ||
        count.toDouble() != (raw as Number).toDouble() ||
        count.toInt() != result.events.size
    ) throw ProtocolViolation("attention_count_mismatch")
    return result
}

/** One foreground SSH connection and one exact non-PTY Radar command channel. */
class JschForegroundTransport(
    private val terminalListener: (String) -> Unit = {},
) : Closeable {
    private var session: Session? = null
    private var command: ChannelExec? = null
    private var protocol: BoundedJsonlSession? = null
    private var lifecycle: PostConnectLifecycle? = null

    fun connect(profile: PersistedHostProfile): TransportConnectResult {
        close()
        lifecycle = null
        val repository = ExactHostKeyRepository(profile)
        var stage = ConnectStage.SSH
        return try {
            val identity = AndroidKeystoreP256Identity(profile.id, profile.keystoreAlias)
            check(identity.exists()) { "identity_missing" }
            val jsch = JSch().apply {
                setIdentityRepository(SingleIdentityRepository(identity))
                setHostKeyRepository(repository)
            }
            val ownedSession = jsch.getSession(profile.user, profile.host, profile.port).apply {
                setConfig("StrictHostKeyChecking", "yes")
                setConfig("PreferredAuthentications", "publickey")
                setConfig("server_host_key", SUPPORTED_SERVER_HOST_KEYS)
                setConfig("FingerprintHash", "sha-256")
            }
            session = ownedSession
            ownedSession.connect(10_000)

            stage = ConnectStage.PROCESS
            val ownedCommand = ownedSession.openChannel("exec") as ChannelExec
            command = ownedCommand
            ownedCommand.setPty(false)
            ownedCommand.setCommand(RADAR_COMMAND)
            val ownedLifecycle = PostConnectLifecycle(
                ::releaseOwnedResources,
                terminalListener = terminalListener,
            )
            lifecycle = ownedLifecycle
            // Drain immediately before exec/connect and before protocol initialization.
            ownedLifecycle.drainStderr(ownedCommand.extInputStream)
            ownedCommand.connect(10_000)

            stage = ConnectStage.PROTOCOL
            val ownedProtocol = BoundedJsonlSession(
                ownedCommand.inputStream,
                ownedCommand.outputStream,
            )
            protocol = ownedProtocol
            val state = ownedProtocol.initializeAndReadState()
            val baseline = validateAttentionPoll(
                ownedProtocol.call("attention/poll", allowAttentionEvents = true),
            )
            if (baseline.events.isNotEmpty()) throw ProtocolViolation("attention_replay")
            startCloseMonitor(ownedSession, ownedCommand, ownedLifecycle)
            TransportConnectResult.Connected(state)
        } catch (_: ProtocolViolation) {
            close()
            TransportConnectResult.Failed("protocol_failed")
        } catch (exception: Exception) {
            val presented = repository.presented
            close()
            if (profile.pin == null && presented != null) {
                TransportConnectResult.HostReviewRequired(presented)
            } else {
                classifyConnectFailure(stage, presented, profile, exception)
            }
        }
    }

    fun readPreview(sessionId: String, limit: Int): JSONObject =
        requireProtocol().call(
            "preview/read",
            JSONObject()
                .put("session_id", sessionId)
                .put("limit", limit.coerceIn(1, 200))
                .put("contract_version", requireProtocol().previewContractVersion),
        ).result

    fun pollAttention(): RpcCallResult =
        validateAttentionPoll(
            requireProtocol().call("attention/poll", allowAttentionEvents = true),
        )

    fun pollAttentionAndReadState(): PollStateResult {
        val result = requireProtocol().pollAttentionAndReadState()
        validateAttentionPoll(result.poll)
        return result
    }

    fun requestRemoteShutdown(): Boolean = try {
        requireProtocol().call("shutdown").result.optBoolean("shutdown")
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

    private fun requireProtocol(): BoundedJsonlSession =
        protocol ?: throw ProtocolViolation("connection_invalid")

    private fun startCloseMonitor(
        ownedSession: Session,
        ownedCommand: ChannelExec,
        ownedLifecycle: PostConnectLifecycle,
    ) {
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
            name = "codex-radar-command"
            isDaemon = true
            start()
        }
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
