package dev.codexradar.cockpit

import org.junit.Assert.assertTrue
import org.junit.Test

class FixtureContractTest {
    @Test fun shared_fixture_declares_only_read_protocol_and_bounded_preview() {
        val text = javaClass.classLoader!!.getResource("mobile-rpc-v1.rich.json")!!.readText()
        assertTrue(text.contains("codex-radar.read-protocol"))
        assertTrue(text.contains("preview/read"))
        assertTrue(text.contains("\"limit\": 10"))
        assertTrue(text.contains("waiting-1"))
        assertTrue(text.contains("running-2"))
        assertTrue(text.contains("\"project\": \"context\""))
        assertTrue(text.contains("\"requires_attention\": true"))
        assertTrue(text.contains("done [REDACTED]"))
        assertTrue(!text.contains("thread/send"))
    }
}
