package dev.codexradar.cockpit

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import dev.codexradar.cockpit.domain.CockpitEvent
import dev.codexradar.cockpit.domain.CockpitReducer
import dev.codexradar.cockpit.domain.CockpitState
import dev.codexradar.cockpit.domain.ConnectionPhase
import dev.codexradar.cockpit.domain.RadarSession
import dev.codexradar.cockpit.profile.PersistedHostProfile
import dev.codexradar.cockpit.profile.SharedPreferencesHostProfileStore
import dev.codexradar.cockpit.protocol.CockpitProtocolClient
import dev.codexradar.cockpit.protocol.FixtureProtocolClient
import dev.codexradar.cockpit.protocol.ForegroundSshProtocolClient
import dev.codexradar.cockpit.transport.AndroidKeystoreP256Identity

class MainActivity : Activity() {
    private var state = CockpitState()
    private lateinit var protocol: CockpitProtocolClient
    private lateinit var store: SharedPreferencesHostProfileStore
    private var persisted: PersistedHostProfile? = null
    private var fixtureMode = false
    private lateinit var connection: TextView
    private lateinit var profileView: TextView
    private lateinit var trust: TextView
    private lateinit var attention: Button
    private lateinit var content: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        store = SharedPreferencesHostProfileStore(this)
        fixtureMode = intent.getBooleanExtra(EXTRA_FIXTURE_MODE, false)
        persisted = store.load()
        protocol = if (fixtureMode) {
            FixtureProtocolClient(this)
        } else {
            persisted?.let(::ForegroundSshProtocolClient) ?: FixtureProtocolClient(this)
        }
        connection = findViewById(R.id.connection)
        profileView = findViewById(R.id.profile)
        trust = findViewById(R.id.trust)
        attention = findViewById(R.id.attention)
        content = findViewById(R.id.content)
        findViewById<Button>(R.id.create_profile).setOnClickListener { createProfile() }
        findViewById<Button>(R.id.connect).setOnClickListener { connect() }
        findViewById<Button>(R.id.reconnect).setOnClickListener { connect() }
        findViewById<Button>(R.id.disconnect).setOnClickListener { disconnect() }
        findViewById<Button>(R.id.approve_host).setOnClickListener { approveHost() }
        findViewById<Button>(R.id.repair_pin).setOnClickListener { confirmRepairPin() }
        findViewById<Button>(R.id.replace_identity).setOnClickListener { confirmReplaceIdentity() }
        findViewById<Button>(R.id.delete_profile).setOnClickListener { confirmDeleteProfile() }
        findViewById<Button>(R.id.poll_attention).setOnClickListener { protocol.pollAttention(::dispatch) }
        findViewById<Button>(R.id.fixture_error).apply {
            visibility = if (fixtureMode) View.VISIBLE else View.GONE
            setOnClickListener { dispatch(CockpitEvent.Failed("fixture_connection_failed")) }
        }
        attention.setOnClickListener {
            state.attention?.let { notice ->
                state.sessions.firstOrNull { it.id == notice.sessionId }?.let(::openSession)
            }
        }
        render()
    }

    private fun createProfile() {
        if (fixtureMode || persisted != null) return
        try {
            val created = store.create(
                findViewById<EditText>(R.id.profile_label).text.toString(),
                findViewById<EditText>(R.id.profile_host).text.toString(),
                findViewById<EditText>(R.id.profile_port).text.toString().toInt(),
                findViewById<EditText>(R.id.profile_user).text.toString(),
            )
            (protocol as? ForegroundSshProtocolClient)?.dispose()
            try {
                AndroidKeystoreP256Identity(created.id, created.keystoreAlias).createKeyPair()
            } catch (exception: Exception) {
                store.delete(created.id)
                throw exception
            }
            persisted = created
            protocol = ForegroundSshProtocolClient(created)
        } catch (_: Exception) {
            dispatch(CockpitEvent.Failed("profile_invalid"))
        }
        render()
    }

    private fun connect() {
        if (!fixtureMode && persisted == null) {
            dispatch(CockpitEvent.Failed("profile_required"))
            return
        }
        val profile = persisted
        if (!fixtureMode && profile != null &&
            !AndroidKeystoreP256Identity(profile.id, profile.keystoreAlias).exists()
        ) {
            dispatch(CockpitEvent.Failed("identity_missing"))
            return
        }
        protocol.connect(::dispatch)
    }

    private fun approveHost() {
        val profile = persisted ?: return
        val client = protocol as? ForegroundSshProtocolClient ?: return
        val pin = client.pendingHostKeyPin() ?: return
        val updated = store.approvePin(profile.id, pin)
        persisted = updated
        client.updateProfile(updated)
        client.connect(::dispatch) // always a fresh connection after explicit review
    }

    private fun confirmRepairPin() {
        val profile = persisted ?: return
        AlertDialog.Builder(this)
            .setTitle("Repair host pin?")
            .setMessage("The saved host identity will be removed. Reconnect and review the new algorithm and SHA-256 fingerprint before approval.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Remove saved pin") { _, _ ->
                disconnect()
                val updated = store.clearPin(profile.id)
                persisted = updated
                (protocol as? ForegroundSshProtocolClient)?.updateProfile(updated)
                render()
            }
            .show()
    }

    private fun confirmReplaceIdentity() {
        val profile = persisted ?: return
        val identity = AndroidKeystoreP256Identity(profile.id, profile.keystoreAlias)
        if (identity.exists()) return
        AlertDialog.Builder(this)
            .setTitle("Create replacement identity?")
            .setMessage("A new non-exportable key will be created. Add the displayed public key to the host before connecting.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Create key") { _, _ ->
                identity.createKeyPair()
                render()
            }
            .show()
    }

    private fun confirmDeleteProfile() {
        val profile = persisted ?: return
        AlertDialog.Builder(this)
            .setTitle("Delete host profile and key?")
            .setMessage("This deletes the endpoint, saved host pin, and non-exportable AndroidKeyStore identity.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Delete") { _, _ ->
                (protocol as? ForegroundSshProtocolClient)?.dispose() ?: disconnect()
                AndroidKeystoreP256Identity(profile.id, profile.keystoreAlias).delete()
                store.delete(profile.id)
                persisted = null
                protocol = FixtureProtocolClient(this)
                dispatch(CockpitEvent.Disconnect)
            }
            .show()
    }

    private fun disconnect() {
        protocol.disconnect()
        dispatch(CockpitEvent.Disconnect)
    }

    private fun dispatch(event: CockpitEvent) {
        state = CockpitReducer.reduce(state, event)
        render()
    }

    private fun render() {
        connection.text = when (state.phase) {
            ConnectionPhase.DISCONNECTED -> "Disconnected — foreground monitoring is inactive"
            ConnectionPhase.CONNECTING -> "Connecting to ${state.profile?.label ?: "host"}…"
            ConnectionPhase.REVIEW_HOST -> "Host identity review required before authentication"
            ConnectionPhase.CONNECTED -> "Connected — read-only Radar RPC (foreground only)"
            ConnectionPhase.ERROR -> "Connection error: ${state.errorCode ?: "unknown"}"
        }
        val identity = persisted?.let { AndroidKeystoreP256Identity(it.id, it.keystoreAlias) }
        profileView.text = if (fixtureMode) {
            "Host profile: Fixture host (explicit test mode)"
        } else persisted?.let {
            val publicKey = if (identity?.exists() == true) identity.openSshPublicKey()
            else "Identity missing — explicitly replace it and update host authorized_keys"
            "Host profile: ${it.label} — ${it.user}@${it.host}:${it.port}\nPublic key only: $publicKey"
        } ?: "Create one immutable host profile to begin"
        trust.text = state.hostKeyReview?.let {
            "Review ${persisted?.host}:${persisted?.port}\nAlgorithm: ${it.algorithm}\nFingerprint: ${it.sha256}"
        } ?: persisted?.pin?.let {
            "Pinned host key — ${it.algorithm} ${it.sha256}"
        } ?: "No host key approved"
        findViewById<Button>(R.id.approve_host).visibility =
            if (state.phase == ConnectionPhase.REVIEW_HOST) View.VISIBLE else View.GONE
        findViewById<LinearLayout>(R.id.profile_form).visibility =
            if (!fixtureMode && persisted == null) View.VISIBLE else View.GONE
        findViewById<Button>(R.id.create_profile).visibility =
            if (!fixtureMode && persisted == null) View.VISIBLE else View.GONE
        findViewById<Button>(R.id.repair_pin).visibility =
            if (!fixtureMode && persisted?.pin != null) View.VISIBLE else View.GONE
        findViewById<Button>(R.id.replace_identity).visibility =
            if (!fixtureMode && persisted != null && identity?.exists() == false) View.VISIBLE else View.GONE
        findViewById<Button>(R.id.delete_profile).visibility =
            if (!fixtureMode && persisted != null) View.VISIBLE else View.GONE
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
                content.addView(TextView(this).apply { text = line; setPadding(12, 4, 12, 4) })
            }
        }
        state.previewErrorCode?.let { addHeading("Preview unavailable: $it") }
    }

    private fun openSession(session: RadarSession) {
        dispatch(CockpitEvent.Select(session.id))
        protocol.readPreview(session, 20, ::dispatch)
    }

    private fun addHeading(text: String) {
        content.addView(TextView(this).apply {
            this.text = text
            textSize = 18f
            setPadding(0, 12, 0, 4)
        })
    }

    private fun addSession(section: String?, session: RadarSession) {
        content.addView(Button(this).apply {
            text = listOfNotNull(
                section,
                "${session.project}: ${session.title} [${session.status.name.lowercase()}]",
            ).joinToString(" — ")
            contentDescription = "Open ${session.title}"
            setOnClickListener { openSession(session) }
        })
    }

    override fun onStop() {
        disconnect()
        super.onStop()
    }

    override fun onDestroy() {
        (protocol as? ForegroundSshProtocolClient)?.dispose()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_FIXTURE_MODE = "dev.codexradar.FIXTURE_MODE"
    }
}
