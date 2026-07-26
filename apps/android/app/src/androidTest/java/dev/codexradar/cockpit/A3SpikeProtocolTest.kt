package dev.codexradar.cockpit

import dev.codexradar.cockpit.a3spike.*
import dev.codexradar.cockpit.protocol.MobileProtocolParser
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec

class A3SpikeProtocolTest {
    @Test fun exact_command_is_fixed_and_non_interactive() {
        assertEquals("codex-radar mobile rpc", RADAR_COMMAND)
        assertFalse(RADAR_COMMAND.contains("\n"))
        assertFalse(RADAR_COMMAND.contains(";"))
    }

    @Test fun host_key_requires_explicit_pin_then_matches_exact_identity() {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"))
        val key = generator.generateKeyPair().public
        val unknown = SpikeHostProfile("immutable", "host.test", 22, "operator")
        val review = ExactHostKeyVerifier(unknown)
        assertFalse(review.verify("host.test", 22, key))
        val presented = requireNotNull(review.presented)
        assertTrue(presented.sha256.startsWith("SHA256:"))

        val pinned = unknown.copy(
            pinnedAlgorithm = presented.algorithm,
            pinnedSha256 = presented.sha256,
        )
        assertTrue(ExactHostKeyVerifier(pinned).verify("host.test", 22, key))
        assertFalse(ExactHostKeyVerifier(pinned.copy(pinnedSha256 = "SHA256:changed")).verify("host.test", 22, key))
        assertFalse(ExactHostKeyVerifier(pinned).verify("other.test", 22, key))
    }

    @Test fun outbound_accepts_max_and_rejects_max_plus_one_before_write() {
        val max = 32
        val output = ByteArrayOutputStream()
        BoundedJsonlSession(ByteArrayInputStream(byteArrayOf()), output, max).writeFrame("x".repeat(max))
        assertEquals(max + 1, output.size())

        val rejectedOutput = ByteArrayOutputStream()
        val session = BoundedJsonlSession(ByteArrayInputStream(byteArrayOf()), rejectedOutput, max)
        val error = assertThrows(ProtocolViolation::class.java) { session.writeFrame("x".repeat(max + 1)) }
        assertEquals("frame_too_large", error.code)
        assertEquals(0, rejectedOutput.size())
    }

    @Test fun inbound_accepts_max_and_rejects_max_plus_one_before_parse() {
        val max = 32
        val exact = """{"id":1,"result":{"v":1}}""".padEnd(max, ' ') + "\n"
        val accepted = BoundedJsonlSession(ByteArrayInputStream(exact.toByteArray()), ByteArrayOutputStream(), max)
        assertEquals(1, accepted.readFrame().getInt("id"))

        val over = "x".repeat(max + 1) + "\n"
        val rejected = BoundedJsonlSession(ByteArrayInputStream(over.toByteArray()), ByteArrayOutputStream(), max)
        assertEquals(
            "frame_too_large",
            assertThrows(ProtocolViolation::class.java) { rejected.readFrame() }.code,
        )
    }

    @Test fun malformed_duplicate_and_version_incompatible_poison_connection() {
        val malformed = BoundedJsonlSession(
            ByteArrayInputStream("not-json\n".toByteArray()),
            ByteArrayOutputStream(),
        )
        assertEquals("malformed_frame", assertThrows(ProtocolViolation::class.java) { malformed.readFrame() }.code)
        assertEquals("connection_invalid", assertThrows(ProtocolViolation::class.java) { malformed.readFrame() }.code)

        val duplicatedInput = """
            {"id":1,"result":{}}
            {"id":1,"result":{}}
        """.trimIndent() + "\n"
        val duplicate = BoundedJsonlSession(ByteArrayInputStream(duplicatedInput.toByteArray()), ByteArrayOutputStream())
        duplicate.call("first")
        assertEquals(
            "duplicate_response_id",
            assertThrows(ProtocolViolation::class.java) { duplicate.call("second") }.code,
        )

        val incompatibleInput = """
            {"id":1,"result":{"protocol":"codex-radar.read-protocol","version":2,"preview_contract_version":2,"attention_delivery":"foreground-poll"}}
        """.trimIndent() + "\n"
        val incompatible = BoundedJsonlSession(ByteArrayInputStream(incompatibleInput.toByteArray()), ByteArrayOutputStream())
        assertEquals(
            "protocol_incompatible",
            assertThrows(ProtocolViolation::class.java) { incompatible.initializeAndReadState() }.code,
        )
    }

    @Test fun deterministic_exchange_reuses_a2_domain_parser() {
        val input = """
            {"id":1,"result":{"protocol":"codex-radar.read-protocol","version":1,"preview_contract_version":2,"attention_delivery":"foreground-poll"}}
            {"id":2,"result":{"contract":"codex-radar.display-state","version":1,"sessions":[{"session_id":"opaque","project":"radar","display_status":"waiting_approval","archive_state":"active","requires_attention":true}]}}
        """.trimIndent() + "\n"
        val state = BoundedJsonlSession(
            ByteArrayInputStream(input.toByteArray()),
            ByteArrayOutputStream(),
        ).initializeAndReadState()
        val sessions = MobileProtocolParser.parseSessions(state.getJSONArray("sessions"))
        assertEquals(listOf("opaque"), sessions.map { it.id.value })
        assertTrue(sessions.single().requiresAttention)
    }

    @Test fun transport_failures_expose_only_stable_codes() {
        val values = listOf(
            SpikeResult.Failed("host_key_unavailable"),
            SpikeResult.Failed("ssh_connection_failed"),
            SpikeResult.Failed("host_key_mismatch"),
            SpikeResult.Failed("authentication_failed"),
            SpikeResult.Failed("process_launch_failed"),
            SpikeResult.Failed("protocol_failed"),
            SpikeResult.Failed("provider_conflict"),
        )
        assertTrue(values.all { it.code.matches(Regex("[a-z_]+")) })
        assertTrue(values.none { it.code.contains("/") || it.code.contains(":") })
    }
}
