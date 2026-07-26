package dev.codexradar.cockpit

import dev.codexradar.cockpit.protocol.BoundedJsonlSession
import dev.codexradar.cockpit.protocol.ProtocolViolation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import dev.codexradar.cockpit.protocol.RemoteMethodError

class BoundedJsonlSessionTest {
    @Test fun initializes_then_reads_state_with_exact_methods() {
        val inbound = (
            """{"id":1,"result":{"protocol":"codex-radar.read-protocol","version":1,"preview_contract_version":2,"attention_delivery":"foreground-poll"}}""" + "\n" +
                """{"id":2,"result":{"contract":"codex-radar.display-state","version":1,"sessions":[]}}""" + "\n"
            ).toByteArray()
        val output = ByteArrayOutputStream()
        val state = BoundedJsonlSession(ByteArrayInputStream(inbound), output).initializeAndReadState()
        assertEquals(0, state.getJSONArray("sessions").length())
        val requests = output.toString(Charsets.UTF_8.name())
        assertTrue(requests.contains("\"method\":\"initialize\""))
        assertTrue(requests.contains("\"method\":\"state/read\""))
    }

    @Test fun oversized_frame_poisoned_and_does_not_parse() {
        val input = ByteArrayInputStream("12345\n".toByteArray())
        val session = BoundedJsonlSession(input, ByteArrayOutputStream(), maxBytes = 4)
        val first = runCatching { session.readFrame() }.exceptionOrNull() as ProtocolViolation
        assertEquals("frame_too_large", first.code)
        val second = runCatching { session.readFrame() }.exceptionOrNull() as ProtocolViolation
        assertEquals("connection_invalid", second.code)
    }

    @Test fun malformed_utf8_is_rejected_with_sanitized_code() {
        val session = BoundedJsonlSession(
            ByteArrayInputStream(byteArrayOf(0xc3.toByte(), 0x28, '\n'.code.toByte())),
            ByteArrayOutputStream(),
        )
        val error = runCatching { session.readFrame() }.exceptionOrNull() as ProtocolViolation
        assertEquals("malformed_frame", error.code)
    }

    @Test fun exact_one_mib_frames_pass_and_next_byte_fails_in_both_directions() {
        val exactOutput = ByteArrayOutputStream()
        BoundedJsonlSession(ByteArrayInputStream(ByteArray(0)), exactOutput)
            .writeFrame("x".repeat(1_048_576))
        assertEquals(1_048_577, exactOutput.size())
        val outboundError = runCatching {
            BoundedJsonlSession(ByteArrayInputStream(ByteArray(0)), ByteArrayOutputStream())
                .writeFrame("x".repeat(1_048_577))
        }.exceptionOrNull() as ProtocolViolation
        assertEquals("frame_too_large", outboundError.code)

        val exactJson = """{"x":"""" + "x".repeat(1_048_568) + "\"}\n"
        val exact = BoundedJsonlSession(
            ByteArrayInputStream(exactJson.toByteArray()),
            ByteArrayOutputStream(),
        ).readFrame()
        assertEquals(1_048_568, exact.getString("x").length)
    }

    @Test fun max_plus_one_inbound_fails_before_json_parse() {
        val inbound = ByteArray(1_048_577) { 'x'.code.toByte() } + '\n'.code.toByte()
        val error = runCatching {
            BoundedJsonlSession(ByteArrayInputStream(inbound), ByteArrayOutputStream()).readFrame()
        }.exceptionOrNull() as ProtocolViolation
        assertEquals("frame_too_large", error.code)
    }

    @Test fun negotiated_v1_is_retained_and_multiple_interleaved_events_are_validated() {
        val inbound = listOf(
            """{"id":1,"result":{"protocol":"codex-radar.read-protocol","version":1,"preview_contract_version":1,"attention_delivery":"foreground-poll"}}""",
            """{"id":2,"result":{"contract":"codex-radar.display-state","version":1,"sessions":[]}}""",
            """{"event":"attention","params":{"sequence":1,"session_id":"s1","project":"p","status":"waiting_approval"}}""",
            """{"event":"attention","params":{"sequence":2,"session_id":"s2","project":"p","status":"done"}}""",
            """{"id":3,"result":{"events_emitted":2}}""",
        ).joinToString("\n", postfix = "\n")
        val session = BoundedJsonlSession(
            ByteArrayInputStream(inbound.toByteArray()),
            ByteArrayOutputStream(),
        )
        session.initializeAndReadState()
        assertEquals(1, session.previewContractVersion)
        assertEquals(2, session.call("attention/poll", allowAttentionEvents = true).events.size)
    }

    @Test fun duplicate_id_mixed_event_response_and_malformed_error_poison_connection() {
        fun violation(frame: String): ProtocolViolation {
            val session = BoundedJsonlSession(
                ByteArrayInputStream((frame + "\n").toByteArray()),
                ByteArrayOutputStream(),
            )
            return runCatching { session.call("state/read", allowAttentionEvents = true) }
                .exceptionOrNull() as ProtocolViolation
        }
        assertEquals(
            "unexpected_event",
            violation("""{"event":"attention","id":1,"params":{"sequence":1,"session_id":"s","project":"p","status":"done"}}""").code,
        )
        assertEquals(
            "malformed_response",
            violation("""{"id":1,"result":{},"error":{"code":"bad"}}""").code,
        )
        assertEquals(
            "malformed_response",
            violation("""{"id":1,"error":{"code":"BAD DETAIL"}}""").code,
        )
    }

    @Test fun valid_remote_error_is_method_local_but_duplicate_response_id_poisoned() {
        val input = listOf(
            """{"id":1,"error":{"code":"transcript_unavailable"}}""",
            """{"id":2,"result":{}}""",
            """{"id":2,"result":{}}""",
        ).joinToString("\n", postfix = "\n")
        val session = BoundedJsonlSession(
            ByteArrayInputStream(input.toByteArray()),
            ByteArrayOutputStream(),
        )
        assertTrue(runCatching { session.call("preview/read") }.exceptionOrNull() is RemoteMethodError)
        session.call("state/read")
        val duplicate = runCatching { session.call("state/read") }.exceptionOrNull() as ProtocolViolation
        assertEquals("duplicate_response_id", duplicate.code)
    }
}
