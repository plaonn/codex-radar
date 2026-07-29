package dev.codexradar.cockpit

import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ListView
import android.widget.TextView
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.codexradar.cockpit.domain.CockpitRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicBoolean

@RunWith(AndroidJUnit4::class)
class MainActivityTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    @get:Rule val activityRule = ActivityScenarioRule<MainActivity>(fixtureIntent())

    @Test fun fixture_ui_covers_product_home_detail_preview_attention_error_and_resume() {
        activityRule.scenario.onActivity { activity ->
            assertEquals("연결", activity.findViewById<Button>(R.id.primary_action).text)
            assertDefaultHomeHasNoConnectionSecrets(activity)
            activity.findViewById<Button>(R.id.primary_action).performClick()
            assertEquals("연결 중…", activity.findViewById<Button>(R.id.primary_action).text)
        }
        waitFor(activityRule.scenario) {
            it.findViewById<TextView>(R.id.connection).text.contains("연결됨")
        }
        activityRule.scenario.onActivity { activity ->
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
            clickRow(list, "waiting-1")
            assertEquals(View.VISIBLE, activity.findViewById<View>(R.id.thread_detail).visibility)
            assertTrue(
                activity.findViewById<TextView>(R.id.preview_feedback).text
                    .contains("아직 요청하지 않았습니다"),
            )
            assertEquals(0, activity.findViewById<ViewGroup>(R.id.preview_content).childCount)
            activity.findViewById<Button>(R.id.preview_action).performClick()
        }
        instrumentation.waitForIdleSync()
        activityRule.scenario.onActivity { activity ->
            val rendered = visibleText(activity.findViewById(R.id.preview_content))
            assertTrue(rendered.contains("show summary"))
            assertTrue(rendered.contains("done [REDACTED]"))
            activity.findViewById<Button>(R.id.back_action).performClick()
        }
        waitFor(activityRule.scenario, timeoutMillis = 3_000) {
            it.findViewById<Button>(R.id.attention).visibility == View.VISIBLE
        }
        activityRule.scenario.onActivity { activity ->
            val banner = activity.findViewById<Button>(R.id.attention)
            assertTrue(banner.text.contains("radar"))
            banner.performClick()
            activity.findViewById<Button>(R.id.back_action).performClick()
            activity.findViewById<Button>(R.id.connection_details_action).performClick()
            activity.findViewById<Button>(R.id.fixture_error).performClick()
            assertTrue(
                activity.findViewById<TextView>(R.id.connection).text
                    .contains("합성 테스트 연결"),
            )
            assertEquals("다시 연결", activity.findViewById<Button>(R.id.primary_action).text)
            activity.findViewById<Button>(R.id.primary_action).performClick()
        }
        waitFor(activityRule.scenario) {
            it.findViewById<TextView>(R.id.connection).text.contains("연결됨")
        }

        activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        instrumentation.waitForIdleSync()
        activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        activityRule.scenario.onActivity { activity ->
            assertTrue(activity.findViewById<TextView>(R.id.connection).text.contains("연결되지 않음"))
            assertEquals("연결 재개", activity.findViewById<Button>(R.id.primary_action).text)
        }

        val context = instrumentation.targetContext
        val persistedRoots = listOf(
            context.filesDir,
            java.io.File(context.applicationInfo.dataDir, "shared_prefs"),
            java.io.File(context.applicationInfo.dataDir, "databases"),
        )
        val prohibited = listOf("show summary", "done [REDACTED]", "waiting-1", "fixture.invalid")
        persistedRoots.filter { it.exists() }.flatMap { root ->
            root.walkTopDown().filter { it.isFile }.toList()
        }.forEach { file ->
            val persisted = file.readBytes().toString(Charsets.ISO_8859_1)
            prohibited.forEach { token ->
                assertFalse("$token persisted in ${file.name}", persisted.contains(token))
            }
        }
    }

    @Test fun disconnect_generation_rejects_delayed_fixture_connect_callback() {
        ActivityScenario.launch<MainActivity>(fixtureIntent()).use { scenario ->
            scenario.onActivity {
                it.findViewById<Button>(R.id.primary_action).performClick()
            }
            scenario.moveToState(Lifecycle.State.CREATED)
            instrumentation.waitForIdleSync()
            scenario.moveToState(Lifecycle.State.RESUMED)
            scenario.onActivity {
                assertTrue(it.findViewById<TextView>(R.id.connection).text.contains("연결되지 않음"))
                assertEquals("연결 재개", it.findViewById<Button>(R.id.primary_action).text)
            }
        }
    }

    @Test fun four_hundred_synthetic_threads_keep_attached_list_views_bounded() {
        ActivityScenario.launch<MainActivity>(
            fixtureIntent().putExtra(MainActivity.EXTRA_SYNTHETIC_THREADS, 400),
        ).use { scenario ->
            scenario.onActivity {
                it.findViewById<Button>(R.id.primary_action).performClick()
            }
            waitFor(scenario) {
                it.findViewById<TextView>(R.id.connection).text.contains("연결됨")
            }
            scenario.onActivity {
                val list = it.findViewById<ListView>(R.id.thread_list)
                assertTrue("synthetic model did not exceed 100 rows", list.adapter.count > 100)
                assertTrue(
                    "attached rows scaled with model size: ${list.childCount}/${list.adapter.count}",
                    list.childCount < 40 && list.childCount < list.adapter.count,
                )
            }
        }
    }

    private fun assertDefaultHomeHasNoConnectionSecrets(activity: MainActivity) {
        val text = visibleText(activity.findViewById(R.id.root))
        listOf("fixture.invalid", "SHA256:", "ssh-rsa", "ecdsa-sha2", "Endpoint:")
            .forEach { token -> assertFalse("$token visible on default home", text.contains(token)) }
    }

    private fun clickRow(list: ListView, token: String) {
        val position = (0 until list.adapter.count).first { index ->
            val row = list.adapter.getItem(index)
            row is CockpitRow.Thread && row.session.title.contains(token) ||
                row is CockpitRow.Project && row.name.contains(token)
        }
        list.adapter.getView(position, null, list).performClick()
    }

    private fun visibleText(view: View): String = buildString {
        if (view.visibility != View.VISIBLE) return@buildString
        if (view is TextView) append(view.text).append('\n')
        if (view is ViewGroup) {
            (0 until view.childCount).forEach { append(visibleText(view.getChildAt(it))) }
        }
    }

    private fun waitFor(
        scenario: ActivityScenario<MainActivity>,
        timeoutMillis: Long = 3_000,
        predicate: (MainActivity) -> Boolean,
    ) {
        val deadline = System.currentTimeMillis() + timeoutMillis
        while (System.currentTimeMillis() < deadline) {
            val matched = AtomicBoolean(false)
            scenario.onActivity { matched.set(predicate(it)) }
            instrumentation.waitForIdleSync()
            if (matched.get()) return
            Thread.sleep(50)
        }
        throw AssertionError("fixture UI condition timed out")
    }

    private fun fixtureIntent(): Intent = Intent(
        instrumentation.targetContext,
        MainActivity::class.java,
    ).putExtra(MainActivity.EXTRA_FIXTURE_MODE, true)
}
