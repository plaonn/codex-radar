package dev.codexradar.cockpit

import android.content.Intent
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityTest {
    @get:Rule val activityRule = ActivityScenarioRule<MainActivity>(
        Intent(
            InstrumentationRegistry.getInstrumentation().targetContext,
            MainActivity::class.java,
        ).putExtra(MainActivity.EXTRA_FIXTURE_MODE, true),
    )

    @Test fun fixture_ui_covers_connection_grouping_attention_preview_error_and_reconnect() {
        activityRule.scenario.onActivity { activity ->
            assertTrue(activity.findViewById<android.widget.TextView>(R.id.connection).text.contains("Disconnected"))
            activity.findViewById<android.widget.Button>(R.id.connect).performClick()
            assertTrue(activity.findViewById<android.widget.TextView>(R.id.connection).text.contains("Connecting"))
        }
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        activityRule.scenario.onActivity { activity ->
            val content = activity.findViewById<android.widget.LinearLayout>(R.id.content)
            assertTrue((content.getChildAt(0) as android.widget.Button).text.contains("Attention"))
            val text = (0 until content.childCount).map { content.getChildAt(it) }
                .filterIsInstance<android.widget.TextView>().joinToString("\n") { it.text }
            assertTrue(text.contains("Project: context"))
            assertTrue(text.contains("Project: radar"))
            assertTrue(text.contains("Archived"))

            val banner = activity.findViewById<android.widget.Button>(R.id.attention)
            activity.findViewById<android.widget.Button>(R.id.poll_attention).performClick()
            assertEquals(android.view.View.GONE, banner.visibility)
            activity.findViewById<android.widget.Button>(R.id.poll_attention).performClick()
            assertEquals(android.view.View.VISIBLE, banner.visibility)
            banner.performClick()
            val rendered = (0 until content.childCount).map { content.getChildAt(it) }
                .filterIsInstance<android.widget.TextView>().joinToString("\n") { it.text }
            assertTrue(rendered.contains("Preview (2/20 messages, memory only)"))
            assertTrue(rendered.contains("show summary"))
            assertTrue(rendered.contains("done [REDACTED]"))

            activity.findViewById<android.widget.Button>(R.id.fixture_error).performClick()
            assertTrue(activity.findViewById<android.widget.TextView>(R.id.connection).text.contains("fixture_connection_failed"))
            activity.findViewById<android.widget.Button>(R.id.reconnect).performClick()
        }
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        activityRule.scenario.onActivity { activity ->
            assertTrue(activity.findViewById<android.widget.TextView>(R.id.connection).text.contains("Connected"))
            assertEquals(android.view.View.GONE, activity.findViewById<android.widget.Button>(R.id.attention).visibility)
            activity.findViewById<android.widget.Button>(R.id.disconnect).performClick()
            assertTrue(activity.findViewById<android.widget.TextView>(R.id.connection).text.contains("Disconnected"))
        }

        val context = InstrumentationRegistry.getInstrumentation().targetContext
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
            prohibited.forEach { token -> assertFalse("$token persisted in ${file.name}", persisted.contains(token)) }
        }
    }
}
