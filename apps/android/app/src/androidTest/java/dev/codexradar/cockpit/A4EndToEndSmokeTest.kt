package dev.codexradar.cockpit

import android.content.Context
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.codexradar.cockpit.profile.SharedPreferencesHostProfileStore
import dev.codexradar.cockpit.protocol.RemoteMethodError
import dev.codexradar.cockpit.domain.CockpitRow
import dev.codexradar.cockpit.transport.AndroidKeystoreP256Identity
import dev.codexradar.cockpit.transport.JschForegroundTransport
import dev.codexradar.cockpit.transport.TransportConnectResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyStore
import java.util.concurrent.atomic.AtomicBoolean

@RunWith(AndroidJUnit4::class)
class A4EndToEndSmokeTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val arguments: Bundle get() = InstrumentationRegistry.getArguments()
    private val context: Context get() = instrumentation.targetContext
    private val profileId = "a4-disposable-profile"
    private val alias = AndroidKeystoreP256Identity.aliasFor(profileId)

    @Test fun prepare_non_exportable_keystore_key() {
        assumeTrue(arguments.getString("a4_prepare_key") == "true")
        context.getSharedPreferences("host_profile_v1", Context.MODE_PRIVATE).edit().clear().commit()
        AndroidKeystoreP256Identity(profileId, alias).delete()
        val identity = AndroidKeystoreP256Identity(profileId, alias)
        val pair = identity.createKeyPair()
        assertEquals(null, pair.private.encoded)
        assertTrue(
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.containsAlias(alias),
        )
        val publicOnly = identity.openSshPublicKey()
        assertTrue(publicOnly.startsWith("ecdsa-sha2-nistp256 "))
        assertFalse(publicOnly.contains("PRIVATE"))
        instrumentation.sendStatus(
            2,
            Bundle().apply { putString("a4_public_key_openssh", publicOnly) },
        )
    }

    @Test fun foreground_ui_state_preview_attention_background_reconnect_and_failures() {
        val host = arguments.getString("a4_host")
        val port = arguments.getString("a4_port")?.toIntOrNull()
        val user = arguments.getString("a4_user")
        val authPort = arguments.getString("a4_auth_port")?.toIntOrNull()
        val malformedPort = arguments.getString("a4_malformed_port")?.toIntOrNull()
        val oversizedPort = arguments.getString("a4_oversized_port")?.toIntOrNull()
        assumeTrue(
            "disposable A4 endpoints required",
            host != null && port != null && user != null &&
                authPort != null && malformedPort != null && oversizedPort != null,
        )
        seedUnpinnedProfile(host!!, port!!, user!!)

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { it.findViewById<Button>(R.id.primary_action).performClick() }
            waitFor(scenario) {
                it.findViewById<TextView>(R.id.connection).text.contains("호스트 확인")
            }
            scenario.onActivity { activity ->
                val trust = activity.findViewById<TextView>(R.id.host_review_details).text.toString()
                assertTrue(trust.contains("Algorithm: ecdsa-sha2-nistp256"))
                assertTrue(trust.contains("Fingerprint: SHA256:"))
                assertFalse(trust.contains(host))
                assertEquals("이 호스트 키 승인", activity.findViewById<Button>(R.id.primary_action).text)
                signalHarness("host_review_ready")
                activity.findViewById<Button>(R.id.primary_action).performClick()
            }
            waitFor(scenario) { it.findViewById<TextView>(R.id.connection).text.contains("연결됨") }
            scenario.onActivity { activity ->
                val list = activity.findViewById<ListView>(R.id.thread_list)
                val headers = (0 until list.adapter.count)
                    .map { list.adapter.getItem(it) }
                    .filterIsInstance<CockpitRow.Header>()
                    .map { it.section }
                assertEquals(
                    listOf(
                        CockpitRow.Section.ATTENTION,
                        CockpitRow.Section.RUNNING,
                        CockpitRow.Section.PROJECTS,
                    ),
                    headers,
                )
                clickRow(list, "alpha")
                clickRow(activity.findViewById(R.id.thread_list), "opaque-preview")
                activity.findViewById<Button>(R.id.preview_action).performClick()
                signalHarness("connected_navigation_ready")
            }
            waitFor(scenario) {
                it.findViewById<TextView>(R.id.preview_feedback).text.contains("memory-only")
            }
            scenario.onActivity { activity ->
                val rendered = renderedText(activity.findViewById(R.id.preview_content)).joinToString("\n")
                assertTrue(rendered.contains("synthetic bounded preview"))
                assertTrue(rendered.contains("[REDACTED]"))
                PROHIBITED_UI_CANARIES.forEach { assertFalse(rendered.contains(it)) }
                signalHarness("preview_ready")
                activity.requestRefreshForTest()
                assertEquals(View.GONE, activity.findViewById<Button>(R.id.attention).visibility)
            }

            signalHarness("waiting_ready")
            waitFor(scenario, action = { it.requestRefreshForTest() }) {
                it.findViewById<Button>(R.id.attention).visibility == View.VISIBLE &&
                    it.findViewById<Button>(R.id.attention).text.contains("확인 필요")
            }
            scenario.onActivity { activity ->
                val banner = activity.findViewById<Button>(R.id.attention)
                assertTrue(banner.text.contains("alpha"))
                signalHarness("waiting_attention_ready")
                banner.performClick()
                activity.findViewById<Button>(R.id.preview_action).performClick()
            }
            waitFor(scenario) {
                it.findViewById<TextView>(R.id.preview_feedback).text.contains("memory-only")
            }

            signalHarness("running_done")
            waitFor(scenario, action = { it.requestRefreshForTest() }) {
                val banner = it.findViewById<Button>(R.id.attention)
                banner.visibility == View.VISIBLE && banner.text.contains("beta") &&
                    banner.text.contains("완료")
            }
            signalHarness("done_attention_ready")

            scenario.moveToState(Lifecycle.State.CREATED)
            signalHarness("backgrounded")
            Thread.sleep(500)
            scenario.moveToState(Lifecycle.State.RESUMED)
            scenario.onActivity { activity ->
                assertTrue(activity.findViewById<TextView>(R.id.connection).text.contains("연결되지 않음"))
                assertEquals(View.GONE, activity.findViewById<Button>(R.id.attention).visibility)
                assertEquals("연결 재개", activity.findViewById<Button>(R.id.primary_action).text)
                signalHarness("foreground_resume_ready")
                activity.findViewById<Button>(R.id.primary_action).performClick()
            }
            waitFor(scenario) { it.findViewById<TextView>(R.id.connection).text.contains("연결됨") }
            scenario.onActivity { activity ->
                activity.requestRefreshForTest()
                assertEquals(View.GONE, activity.findViewById<Button>(R.id.attention).visibility)
                activity.findViewById<Button>(R.id.connection_details_action).performClick()
                activity.findViewById<Button>(R.id.disconnect).performClick()
                assertTrue(activity.findViewById<TextView>(R.id.connection).text.contains("연결되지 않음"))
            }
        }

        val pinned = requireNotNull(SharedPreferencesHostProfileStore(context).load())
        assertNotNull(pinned.pin)
        val rawRequestProbe = JschForegroundTransport()
        assertTrue(rawRequestProbe.connect(pinned) is TransportConnectResult.Connected)
        var rawRequestRejected = false
        try {
            rawRequestProbe.readPreview("A4_RAW_REQUEST_CANARY", 1)
        } catch (_: RemoteMethodError) {
            rawRequestRejected = true
        } finally {
            rawRequestProbe.close()
        }
        assertTrue(rawRequestRejected)
        assertEndpointFailure(pinned.copy(port = authPort!!), "authentication_failed")
        assertEndpointFailure(pinned.copy(port = malformedPort!!), "protocol_failed")
        assertEndpointFailure(pinned.copy(port = oversizedPort!!), "protocol_failed")
        signalHarness("foreground_complete")
    }

    @Test fun persisted_pin_rejects_restarted_host() {
        assumeTrue(arguments.getString("a4_mismatch_expected") == "true")
        val stored = requireNotNull(SharedPreferencesHostProfileStore(context).load())
        val originalPin = requireNotNull(stored.pin)
        assertEquals(
            TransportConnectResult.Failed("host_key_mismatch"),
            JschForegroundTransport().connect(stored),
        )
        assertEquals(originalPin, SharedPreferencesHostProfileStore(context).load()?.pin)
    }

    private fun seedUnpinnedProfile(host: String, port: Int, user: String) {
        check(AndroidKeystoreP256Identity(profileId, alias).exists())
        check(
            context.getSharedPreferences("host_profile_v1", Context.MODE_PRIVATE).edit()
                .clear()
                .putString("profile_id", profileId)
                .putString("label", "Disposable A4 host")
                .putString("host", host)
                .putInt("port", port)
                .putString("user", user)
                .putString("keystore_alias", alias)
                .commit(),
        )
    }

    private fun assertEndpointFailure(template: dev.codexradar.cockpit.profile.PersistedHostProfile, code: String) {
        val unpinned = template.copy(pin = null)
        val review = JschForegroundTransport().connect(unpinned)
        assertTrue(review is TransportConnectResult.HostReviewRequired)
        val pinned = unpinned.copy(
            pin = (review as TransportConnectResult.HostReviewRequired).presented.pin(),
        )
        assertEquals(TransportConnectResult.Failed(code), JschForegroundTransport().connect(pinned))
    }

    private fun signalHarness(step: String) {
        instrumentation.sendStatus(2, Bundle().apply { putString("a4_step", step) })
    }

    private fun waitFor(
        scenario: ActivityScenario<MainActivity>,
        timeoutMillis: Long = 12_000,
        action: ((MainActivity) -> Unit)? = null,
        predicate: (MainActivity) -> Boolean,
    ) {
        val deadline = System.currentTimeMillis() + timeoutMillis
        while (System.currentTimeMillis() < deadline) {
            val matched = AtomicBoolean(false)
            scenario.onActivity {
                action?.invoke(it)
                matched.set(predicate(it))
            }
            instrumentation.waitForIdleSync()
            if (matched.get()) return
            Thread.sleep(100)
        }
        throw AssertionError("A4 UI condition timed out")
    }

    private fun clickRow(list: ListView, token: String) {
        val position = (0 until list.adapter.count).first { index ->
            val row = list.adapter.getItem(index)
            row is CockpitRow.Thread && row.session.title.contains(token) ||
                row is CockpitRow.Project && row.name.contains(token)
        }
        list.adapter.getView(position, null, list).performClick()
    }

    private fun renderedText(content: LinearLayout): List<String> =
        (0 until content.childCount).map { content.getChildAt(it) }
            .filterIsInstance<TextView>()
            .map { it.text.toString() }

    private companion object {
        val PROHIBITED_UI_CANARIES = listOf(
            "sk-A4SensitiveCredentialValue",
            "/synthetic/",
            "transcript_path",
            "A4_RAW_REQUEST_CANARY",
            "A4_UNREDACTED_TRANSCRIPT_CANARY",
            "A4_REMOTE_STDERR_CANARY",
            "PRIVATE KEY",
        )
    }
}
