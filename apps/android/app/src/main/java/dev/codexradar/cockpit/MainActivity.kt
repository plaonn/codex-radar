package dev.codexradar.cockpit

import android.app.Activity
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import dev.codexradar.cockpit.domain.CockpitEvent
import dev.codexradar.cockpit.domain.CockpitReducer
import dev.codexradar.cockpit.domain.CockpitState
import dev.codexradar.cockpit.domain.ConnectionPhase
import dev.codexradar.cockpit.domain.HostProfile
import dev.codexradar.cockpit.domain.RadarSession
import dev.codexradar.cockpit.protocol.FixtureProtocolClient

class MainActivity : Activity() {
    private var state = CockpitState()
    private lateinit var protocol: FixtureProtocolClient
    private lateinit var connection: TextView
    private lateinit var profile: TextView
    private lateinit var attention: Button
    private lateinit var content: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        protocol = FixtureProtocolClient(this)
        connection = findViewById(R.id.connection)
        profile = findViewById(R.id.profile)
        attention = findViewById(R.id.attention)
        content = findViewById(R.id.content)
        findViewById<Button>(R.id.connect).setOnClickListener { connect() }
        findViewById<Button>(R.id.reconnect).setOnClickListener { connect() }
        findViewById<Button>(R.id.disconnect).setOnClickListener { dispatch(CockpitEvent.Disconnect) }
        findViewById<Button>(R.id.poll_attention).setOnClickListener { protocol.pollAttention(state.sessions, ::dispatch) }
        findViewById<Button>(R.id.fixture_error).setOnClickListener { dispatch(CockpitEvent.Failed("fixture_connection_failed")) }
        attention.setOnClickListener {
            state.attention?.let { notice ->
                state.sessions.firstOrNull { it.id == notice.sessionId }?.let { session ->
                    dispatch(CockpitEvent.Select(session.id))
                    protocol.readPreview(session, 20, ::dispatch)
                }
            }
        }
        render()
    }

    private fun connect() {
        // Fixture profile is presentation-only. A3 owns SSH and host trust.
        protocol.connect(HostProfile("Fixture host", "fixture.invalid", 22, "fixture"), ::dispatch)
    }

    private fun dispatch(event: CockpitEvent) {
        state = CockpitReducer.reduce(state, event)
        render()
    }

    private fun render() {
        connection.text = when (state.phase) {
            ConnectionPhase.DISCONNECTED -> "Disconnected — foreground monitoring is inactive"
            ConnectionPhase.CONNECTING -> "Connecting to ${state.profile?.label ?: "host"}…"
            ConnectionPhase.CONNECTED -> "Connected — fixture protocol v1 (foreground only)"
            ConnectionPhase.ERROR -> "Connection error: ${state.errorCode ?: "unknown"}"
        }
        profile.text = state.profile?.let {
            "Host profile: ${it.label} — ${it.user}@${it.host}:${it.port} (fixture only)"
        } ?: "Host profile: Fixture host (not connected)"
        attention.visibility = if (state.attention == null) View.GONE else View.VISIBLE
        attention.text = state.attention?.let { "Attention: ${it.project} is ${it.status.name.lowercase()}" }
        content.removeAllViews()
        state.attentionSessions().forEach { addSession("Attention", it) }
        state.projects().forEach { (project, sessions) ->
            addHeading("Project: $project")
            sessions.forEach { addSession(null, it) }
        }
        if (state.archived().isNotEmpty()) {
            addHeading("Archived")
            state.archived().forEach { addSession(null, it) }
        }
        state.preview?.let { preview ->
            addHeading("Preview (${preview.lines.size}/${preview.limit} messages, memory only)")
            preview.lines.forEach { line ->
                content.addView(TextView(this).apply {
                    text = line
                    setPadding(12, 4, 12, 4)
                })
            }
        }
        state.previewErrorCode?.let { addHeading("Preview unavailable: $it") }
        if (state.phase == ConnectionPhase.CONNECTED && state.sessions.isEmpty()) addHeading("No active fixture sessions")
    }

    private fun addHeading(text: String) {
        content.addView(TextView(this).apply { this.text = text; textSize = 18f; setPadding(0, 12, 0, 4) })
    }

    private fun addSession(section: String?, session: RadarSession) {
        content.addView(Button(this).apply {
            text = listOfNotNull(section, "${session.project}: ${session.title} [${session.status.name.lowercase()}]").joinToString(" — ")
            contentDescription = "Open ${session.title}"
            setOnClickListener {
                dispatch(CockpitEvent.Select(session.id))
                protocol.readPreview(session, 20, ::dispatch)
            }
        })
    }
}
