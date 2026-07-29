package dev.codexradar.cockpit.protocol

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

const val MAX_JSONL_FRAME_BYTES = 1_048_576
private const val MAX_EVENTS_PER_CALL = 256

class ProtocolViolation(val code: String) : Exception(code)
class RemoteMethodError : Exception()
data class RpcCallResult(val result: JSONObject, val events: List<JSONObject>)
data class PollStateResult(val poll: RpcCallResult, val state: JSONObject)

/**
 * Strict JSONL request/response boundary. Framing and contract failures poison
 * the connection. A valid remote method error remains method-local.
 */
class BoundedJsonlSession(
    private val input: InputStream,
    private val output: OutputStream,
    private val maxBytes: Int = MAX_JSONL_FRAME_BYTES,
) : Closeable {
    private var failed = false
    private var nextId = 1
    private var lastAttentionSequence = 0L
    private val responseIds = mutableSetOf<Int>()
    var previewContractVersion: Int = 0
        private set

    fun initializeAndReadState(): JSONObject {
        val initialized = call(
            "initialize",
            JSONObject()
                .put("protocol_versions", org.json.JSONArray().put(1))
                .put("preview_contract_versions", org.json.JSONArray().put(1).put(2)),
        ).result
        val selectedPreview = initialized.optInt("preview_contract_version", -1)
        if (
            initialized.optString("protocol") != "codex-radar.read-protocol" ||
            initialized.optInt("version", -1) != 1 ||
            selectedPreview !in 1..2 ||
            initialized.optString("attention_delivery") != "foreground-poll"
        ) fail("protocol_incompatible")
        previewContractVersion = selectedPreview
        return readState()
    }

    fun readState(): JSONObject {
        val state = call("state/read").result
        if (
            state.optString("contract") != "codex-radar.display-state" ||
            state.optInt("version", -1) != 1
        ) fail("protocol_incompatible")
        return state
    }

    /**
     * The foreground owner must reconcile the display state immediately after
     * each successful attention poll on this same protocol connection.
     */
    fun pollAttentionAndReadState(): PollStateResult {
        val poll = call("attention/poll", allowAttentionEvents = true)
        return PollStateResult(poll, readState())
    }

    fun call(
        method: String,
        params: JSONObject? = null,
        allowAttentionEvents: Boolean = false,
    ): RpcCallResult {
        if (failed) throw ProtocolViolation("connection_invalid")
        val id = nextId++
        val request = JSONObject().put("id", id).put("method", method)
        if (params != null) request.put("params", params)
        writeFrame(request.toString())
        val events = mutableListOf<JSONObject>()
        while (true) {
            val message = readFrame()
            if (message.has("event")) {
                if (
                    message.has("id") || message.has("result") || message.has("error") ||
                    !allowAttentionEvents || events.size == MAX_EVENTS_PER_CALL
                ) {
                    fail("unexpected_event")
                }
                validateAttentionEvent(message)
                events += message
                continue
            }
            val rawId = message.opt("id")
            val responseId = (rawId as? Number)?.toLong()
            if (
                responseId == null || responseId !in Int.MIN_VALUE..Int.MAX_VALUE ||
                responseId.toDouble() != (rawId as Number).toDouble() ||
                !responseIds.add(responseId.toInt())
            ) {
                fail("duplicate_response_id")
            }
            if (responseId.toInt() != id) fail("unexpected_response_id")
            val hasResult = message.has("result")
            val hasError = message.has("error")
            if (hasResult == hasError || message.has("event")) fail("malformed_response")
            if (hasError) {
                val error = message.optJSONObject("error") ?: fail("malformed_response")
                val code = error.optString("code")
                if (
                    error.length() != 1 ||
                    !code.matches(Regex("[a-z][a-z0-9_]{0,63}"))
                ) fail("malformed_response")
                throw RemoteMethodError()
            }
            val result = message.optJSONObject("result") ?: fail("malformed_response")
            return RpcCallResult(result, events)
        }
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
        val decoded = try {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes.toByteArray()))
                .toString()
        } catch (_: Exception) {
            fail("malformed_frame")
        }
        return try {
            JSONObject(decoded)
        } catch (_: Exception) {
            fail("malformed_frame")
        }
    }

    private fun validateAttentionEvent(message: JSONObject) {
        if (message.optString("event") != "attention") fail("unexpected_event")
        val params = message.optJSONObject("params") ?: fail("unexpected_event")
        val rawSequence = params.opt("sequence")
        val sequence = (rawSequence as? Number)?.toLong() ?: fail("unexpected_event")
        if (
            sequence.toDouble() != (rawSequence as Number).toDouble() ||
            sequence <= lastAttentionSequence ||
            params.optString("session_id").isBlank() ||
            params.optString("project").isBlank() ||
            params.optString("status").isBlank()
        ) fail("unexpected_event")
        lastAttentionSequence = sequence
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
