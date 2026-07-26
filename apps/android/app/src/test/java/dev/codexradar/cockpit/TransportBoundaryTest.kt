package dev.codexradar.cockpit

import com.jcraft.jsch.HostKeyRepository
import dev.codexradar.cockpit.profile.HostKeyPin
import dev.codexradar.cockpit.profile.PersistedHostProfile
import dev.codexradar.cockpit.transport.AndroidKeystoreP256Identity
import dev.codexradar.cockpit.transport.ExactHostKeyRepository
import dev.codexradar.cockpit.transport.PostConnectLifecycle
import dev.codexradar.cockpit.transport.RADAR_COMMAND
import dev.codexradar.cockpit.transport.SUPPORTED_SERVER_HOST_KEYS
import dev.codexradar.cockpit.transport.ConnectStage
import dev.codexradar.cockpit.transport.PresentedHostKey
import dev.codexradar.cockpit.transport.classifyConnectFailure
import dev.codexradar.cockpit.transport.validateAttentionPoll
import dev.codexradar.cockpit.protocol.RpcCallResult
import dev.codexradar.cockpit.protocol.ProtocolViolation
import dev.codexradar.cockpit.protocol.MobileProtocolParser
import com.jcraft.jsch.JSchException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.util.Base64
import java.util.concurrent.atomic.AtomicInteger

class TransportBoundaryTest {
    private fun sshString(value: ByteArray): ByteArray =
        ByteBuffer.allocate(4 + value.size).putInt(value.size).put(value).array()

    private fun rsaBlob(): ByteArray =
        sshString("ssh-rsa".toByteArray()) + sshString(byteArrayOf(1, 0, 1)) +
            sshString(byteArrayOf(1, 2, 3, 4))

    private fun profile(pin: HostKeyPin? = null): PersistedHostProfile {
        val id = "test-profile"
        return PersistedHostProfile(
            id,
            "Loopback",
            "127.0.0.1",
            2222,
            "radar",
            AndroidKeystoreP256Identity.aliasFor(id),
            pin,
        )
    }

    @Test fun exact_pin_is_required_and_changed_key_is_hard_failure() {
        val blob = rsaBlob()
        val unknown = ExactHostKeyRepository(profile())
        assertEquals(HostKeyRepository.NOT_INCLUDED, unknown.check("127.0.0.1", blob))
        val presented = requireNotNull(unknown.presented)
        assertEquals("ssh-rsa", presented.algorithm)
        assertTrue(presented.sha256.startsWith("SHA256:"))

        val approved = ExactHostKeyRepository(profile(presented.pin()))
        assertEquals(HostKeyRepository.OK, approved.check("127.0.0.1", blob))
        val changed = presented.pin().copy(
            keyBase64 = Base64.getEncoder().encodeToString(rsaBlob() + byteArrayOf(9)),
        )
        assertEquals(
            HostKeyRepository.CHANGED,
            ExactHostKeyRepository(profile(changed)).check("127.0.0.1", blob),
        )
    }

    @Test fun command_and_host_algorithm_allowlist_are_exact() {
        assertEquals("codex-radar mobile rpc", RADAR_COMMAND)
        assertEquals(
            "rsa-sha2-512,rsa-sha2-256,ecdsa-sha2-nistp256",
            SUPPORTED_SERVER_HOST_KEYS,
        )
        assertFalse(SUPPORTED_SERVER_HOST_KEYS.contains("ssh-ed25519"))
    }

    @Test fun lifecycle_closes_once_and_discards_bounded_stderr() {
        val closes = AtomicInteger()
        val lifecycle = PostConnectLifecycle({ closes.incrementAndGet() }, maxDiagnosticBytes = 4)
        lifecycle.drainStderr("secret".byteInputStream()).join(1_000)
        assertTrue(lifecycle.awaitClosed(1_000))
        assertEquals("diagnostic_too_large", lifecycle.failureCode())
        lifecycle.explicitClose()
        assertEquals(1, closes.get())

        val explicit = PostConnectLifecycle(closeOwnedResources = {
            closes.incrementAndGet()
            Unit
        })
        explicit.explicitClose()
        assertNull(explicit.failureCode())
        assertEquals(2, closes.get())
    }

    @Test fun stage_failure_categories_are_stable_and_sanitized() {
        val pin = HostKeyPin("ssh-rsa", "SHA256:YWJj", "YWJj")
        val pinned = profile(pin)
        val presented = PresentedHostKey(pin.algorithm, pin.sha256, pin.keyBase64)
        assertEquals(
            "authentication_failed",
            classifyConnectFailure(ConnectStage.SSH, presented, pinned, JSchException("private"))
                .code,
        )
        assertEquals(
            "process_launch_failed",
            classifyConnectFailure(ConnectStage.PROCESS, presented, pinned, JSchException("private"))
                .code,
        )
        assertEquals(
            "protocol_failed",
            classifyConnectFailure(ConnectStage.PROTOCOL, presented, pinned, Exception("private"))
                .code,
        )
    }

    @Test fun attention_count_and_status_mismatch_are_poisoned() {
        val mismatch = RpcCallResult(
            JSONObject("""{"events_emitted":1}"""),
            emptyList(),
        )
        assertEquals(
            "attention_count_mismatch",
            (runCatching { validateAttentionPoll(mismatch) }.exceptionOrNull() as ProtocolViolation).code,
        )
        val unsupported = JSONObject(
            """{"event":"attention","params":{"session_id":"s","project":"p","status":"running"}}""",
        )
        assertTrue(runCatching { MobileProtocolParser.parseAttention(unsupported) }.isFailure)
    }
}
