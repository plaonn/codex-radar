package dev.codexradar.cockpit

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.format.DateFormat
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import dev.codexradar.cockpit.domain.CockpitEvent
import dev.codexradar.cockpit.domain.CockpitReducer
import dev.codexradar.cockpit.domain.CockpitRow
import dev.codexradar.cockpit.domain.CockpitScreen
import dev.codexradar.cockpit.domain.CockpitState
import dev.codexradar.cockpit.domain.ConnectionPhase
import dev.codexradar.cockpit.domain.PrimaryConnectionAction
import dev.codexradar.cockpit.domain.RadarSession
import dev.codexradar.cockpit.domain.RefreshState
import dev.codexradar.cockpit.domain.ThreadStatus
import dev.codexradar.cockpit.profile.PersistedHostProfile
import dev.codexradar.cockpit.profile.SharedPreferencesHostProfileStore
import dev.codexradar.cockpit.protocol.CockpitProtocolClient
import dev.codexradar.cockpit.protocol.FixtureProtocolClient
import dev.codexradar.cockpit.protocol.ForegroundSshProtocolClient
import dev.codexradar.cockpit.transport.AndroidKeystoreP256Identity
import java.util.Date

class MainActivity : Activity() {
    private var state = CockpitState()
    private lateinit var protocol: CockpitProtocolClient
    private lateinit var store: SharedPreferencesHostProfileStore
    private var persisted: PersistedHostProfile? = null
    private var fixtureMode = false
    private val pollingHandler = Handler(Looper.getMainLooper())
    private var pollingGeneration = 0L
    private var pollInFlight = false

    private lateinit var connection: TextView
    private lateinit var refreshFeedback: TextView
    private lateinit var screenTitle: TextView
    private lateinit var primaryAction: Button
    private lateinit var attention: Button
    private lateinit var list: ListView
    private lateinit var listAdapter: CockpitListAdapter
    private lateinit var threadDetail: View
    private lateinit var connectionDetails: View
    private lateinit var hostReview: View
    private lateinit var previewContent: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        store = SharedPreferencesHostProfileStore(this)
        fixtureMode = intent.getBooleanExtra(EXTRA_FIXTURE_MODE, false)
        persisted = store.load()
        protocol = if (fixtureMode) {
            FixtureProtocolClient(
                this,
                intent.getIntExtra(EXTRA_SYNTHETIC_THREADS, 0).coerceIn(0, 500),
            )
        } else {
            persisted?.let(::ForegroundSshProtocolClient) ?: FixtureProtocolClient(this)
        }

        connection = findViewById(R.id.connection)
        refreshFeedback = findViewById(R.id.refresh_feedback)
        screenTitle = findViewById(R.id.screen_title)
        primaryAction = findViewById(R.id.primary_action)
        attention = findViewById(R.id.attention)
        list = findViewById(R.id.thread_list)
        threadDetail = findViewById(R.id.thread_detail)
        connectionDetails = findViewById(R.id.connection_details)
        hostReview = findViewById(R.id.host_review)
        previewContent = findViewById(R.id.preview_content)

        listAdapter = CockpitListAdapter(this, ::onRow)
        list.adapter = listAdapter
        primaryAction.setOnClickListener { performPrimaryAction() }
        findViewById<Button>(R.id.connection_details_action).setOnClickListener {
            dispatch(CockpitEvent.OpenConnectionDetails)
        }
        findViewById<Button>(R.id.archived_action).setOnClickListener {
            dispatch(CockpitEvent.OpenArchived)
        }
        findViewById<Button>(R.id.back_action).setOnClickListener {
            dispatch(CockpitEvent.OpenHome)
        }
        findViewById<Button>(R.id.create_profile).setOnClickListener { createProfile() }
        findViewById<Button>(R.id.disconnect).setOnClickListener { disconnect(false) }
        findViewById<Button>(R.id.cancel_host_review).setOnClickListener { disconnect(false) }
        findViewById<Button>(R.id.repair_pin).setOnClickListener { confirmRepairPin() }
        findViewById<Button>(R.id.replace_identity).setOnClickListener { confirmReplaceIdentity() }
        findViewById<Button>(R.id.delete_profile).setOnClickListener { confirmDeleteProfile() }
        findViewById<Button>(R.id.preview_action).setOnClickListener { readSelectedPreview() }
        findViewById<Button>(R.id.fixture_error).apply {
            visibility = if (fixtureMode) View.VISIBLE else View.GONE
            setOnClickListener { dispatch(CockpitEvent.Failed("fixture_connection_failed")) }
        }
        attention.setOnClickListener {
            state.attention?.let { notice ->
                state.sessions.firstOrNull { it.id == notice.sessionId }?.let(::openThread)
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
            dispatch(CockpitEvent.Disconnect)
        } catch (_: Exception) {
            dispatch(CockpitEvent.Failed("profile_invalid"))
        }
    }

    private fun connect() {
        stopPolling()
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
        client.connect(::dispatch)
    }

    private fun confirmRepairPin() {
        val profile = persisted ?: return
        AlertDialog.Builder(this)
            .setTitle(R.string.repair_pin_title)
            .setMessage(R.string.repair_pin_message)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.remove_saved_pin) { _, _ ->
                disconnect(false)
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
            .setTitle(R.string.replace_identity_title)
            .setMessage(R.string.replace_identity_message)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.create_key) { _, _ ->
                identity.createKeyPair()
                render()
            }
            .show()
    }

    private fun confirmDeleteProfile() {
        val profile = persisted ?: return
        AlertDialog.Builder(this)
            .setTitle(R.string.delete_profile_title)
            .setMessage(R.string.delete_profile_message)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.delete) { _, _ ->
                (protocol as? ForegroundSshProtocolClient)?.dispose() ?: protocol.disconnect()
                AndroidKeystoreP256Identity(profile.id, profile.keystoreAlias).delete()
                store.delete(profile.id)
                persisted = null
                protocol = FixtureProtocolClient(this)
                dispatch(CockpitEvent.Disconnect)
            }
            .show()
    }

    private fun disconnect(foregroundStopped: Boolean) {
        stopPolling()
        protocol.disconnect()
        dispatch(
            if (foregroundStopped) CockpitEvent.ForegroundStopped else CockpitEvent.Disconnect,
        )
    }

    private fun requestRefresh() {
        if (state.phase != ConnectionPhase.CONNECTED || pollInFlight) return
        pollInFlight = true
        dispatch(CockpitEvent.RefreshStarted)
        protocol.pollAttention(::dispatch)
    }

    /** Instrumentation uses the same serialized foreground owner as automatic polling. */
    internal fun requestRefreshForTest() = requestRefresh()

    private fun startPolling() {
        pollingGeneration += 1
        val token = pollingGeneration
        pollInFlight = false
        pollingHandler.post {
            if (token == pollingGeneration) requestRefresh()
        }
    }

    private fun scheduleNextPoll() {
        val token = pollingGeneration
        pollingHandler.postDelayed(
            {
                if (token == pollingGeneration && state.phase == ConnectionPhase.CONNECTED) {
                    requestRefresh()
                }
            },
            POLL_INTERVAL_MILLIS,
        )
    }

    private fun stopPolling() {
        pollingGeneration += 1
        pollInFlight = false
        pollingHandler.removeCallbacksAndMessages(null)
    }

    private fun dispatch(event: CockpitEvent) {
        state = CockpitReducer.reduce(state, event)
        when (event) {
            is CockpitEvent.Connected -> startPolling()
            is CockpitEvent.RefreshReconciled,
            is CockpitEvent.RefreshFailed,
            -> {
                pollInFlight = false
                if (state.phase == ConnectionPhase.CONNECTED) scheduleNextPoll()
            }
            is CockpitEvent.Failed,
            CockpitEvent.Disconnect,
            CockpitEvent.ForegroundStopped,
            -> stopPolling()
            else -> Unit
        }
        render()
    }

    private fun performPrimaryAction() {
        when (currentPrimaryAction()) {
            PrimaryConnectionAction.OPEN_CONNECTION_DETAILS ->
                dispatch(CockpitEvent.OpenConnectionDetails)
            PrimaryConnectionAction.CONNECT,
            PrimaryConnectionAction.RESUME,
            PrimaryConnectionAction.RETRY,
            -> connect()
            PrimaryConnectionAction.APPROVE_HOST -> approveHost()
            PrimaryConnectionAction.REFRESH -> requestRefresh()
            PrimaryConnectionAction.CONNECTING -> Unit
        }
    }

    private fun currentPrimaryAction(): PrimaryConnectionAction {
        val identityReady = fixtureMode || persisted?.let {
            AndroidKeystoreP256Identity(it.id, it.keystoreAlias).exists()
        } == true
        return state.primaryAction(fixtureMode || persisted != null, identityReady)
    }

    private fun onRow(row: CockpitRow) {
        when (row) {
            is CockpitRow.Project -> dispatch(CockpitEvent.OpenProject(row.name))
            is CockpitRow.Thread -> openThread(row.session)
            else -> Unit
        }
    }

    private fun openThread(session: RadarSession) {
        dispatch(CockpitEvent.OpenThread(session.id))
    }

    private fun readSelectedPreview() {
        val session = state.selectedSession() ?: return
        dispatch(CockpitEvent.PreviewStarted)
        protocol.readPreview(session, PREVIEW_LIMIT, ::dispatch)
    }

    private fun render() {
        connection.text = connectionText()
        renderPrimaryAction()
        renderToolbar()
        renderRefresh()
        renderAttention()

        val listVisible = state.screen in setOf(
            CockpitScreen.HOME,
            CockpitScreen.PROJECT,
            CockpitScreen.ARCHIVED,
        )
        list.visibility = if (listVisible) View.VISIBLE else View.GONE
        threadDetail.visibility =
            if (state.screen == CockpitScreen.THREAD) View.VISIBLE else View.GONE
        connectionDetails.visibility =
            if (state.screen == CockpitScreen.CONNECTION_DETAILS) View.VISIBLE else View.GONE
        hostReview.visibility =
            if (state.screen == CockpitScreen.HOST_REVIEW) View.VISIBLE else View.GONE

        if (listVisible) listAdapter.submit(state.rows()) else listAdapter.submit(emptyList())
        renderThreadDetail()
        renderConnectionDetails()
        renderHostReview()
    }

    private fun connectionText(): String = when (state.phase) {
        ConnectionPhase.DISCONNECTED -> getString(R.string.connection_disconnected)
        ConnectionPhase.CONNECTING -> getString(
            R.string.connection_connecting,
            state.profile?.label ?: getString(R.string.host_fallback),
        )
        ConnectionPhase.REVIEW_HOST -> getString(R.string.connection_review_required)
        ConnectionPhase.CONNECTED -> getString(R.string.connection_connected)
        ConnectionPhase.ERROR -> getString(R.string.connection_error, errorText(state.errorCode))
    }

    private fun renderPrimaryAction() {
        val action = currentPrimaryAction()
        primaryAction.text = getString(
            when (action) {
                PrimaryConnectionAction.OPEN_CONNECTION_DETAILS -> R.string.action_connection_setup
                PrimaryConnectionAction.CONNECT -> R.string.action_connect
                PrimaryConnectionAction.RESUME -> R.string.action_resume_connection
                PrimaryConnectionAction.CONNECTING -> R.string.action_connecting
                PrimaryConnectionAction.APPROVE_HOST -> R.string.action_approve_host
                PrimaryConnectionAction.REFRESH -> R.string.action_refresh
                PrimaryConnectionAction.RETRY -> R.string.action_retry
            },
        )
        primaryAction.isEnabled = action != PrimaryConnectionAction.CONNECTING
        primaryAction.contentDescription = primaryAction.text
    }

    private fun renderToolbar() {
        val onHome = state.screen == CockpitScreen.HOME
        findViewById<Button>(R.id.back_action).visibility =
            if (state.screen in setOf(
                    CockpitScreen.PROJECT,
                    CockpitScreen.ARCHIVED,
                    CockpitScreen.THREAD,
                    CockpitScreen.CONNECTION_DETAILS,
                )
            ) View.VISIBLE else View.GONE
        findViewById<Button>(R.id.connection_details_action).visibility =
            if (onHome && state.phase != ConnectionPhase.REVIEW_HOST) View.VISIBLE else View.GONE
        findViewById<Button>(R.id.archived_action).visibility =
            if (onHome && state.phase == ConnectionPhase.CONNECTED) View.VISIBLE else View.GONE
        screenTitle.text = when (state.screen) {
            CockpitScreen.HOME -> getString(R.string.home_title)
            CockpitScreen.PROJECT -> getString(R.string.project_title, state.project ?: "")
            CockpitScreen.ARCHIVED -> getString(R.string.archived_title)
            CockpitScreen.THREAD -> getString(R.string.thread_detail_title)
            CockpitScreen.CONNECTION_DETAILS -> getString(R.string.connection_details_title)
            CockpitScreen.HOST_REVIEW -> getString(R.string.host_review_title)
        }
    }

    private fun renderRefresh() {
        refreshFeedback.text = when (state.refreshState) {
            RefreshState.IDLE -> getString(R.string.refresh_idle)
            RefreshState.LOADING -> getString(R.string.refresh_loading)
            RefreshState.NO_CHANGE -> getString(
                R.string.refresh_no_change,
                formattedLastRefresh(),
            )
            RefreshState.UPDATED -> getString(
                R.string.refresh_updated,
                formattedLastRefresh(),
            )
            RefreshState.ERROR -> getString(R.string.refresh_error)
        }
    }

    private fun formattedLastRefresh(): String = state.lastRefreshAtMillis?.let {
        DateFormat.getTimeFormat(this).format(Date(it))
    } ?: getString(R.string.refresh_time_unknown)

    private fun renderAttention() {
        attention.visibility =
            if (
                state.attention != null &&
                state.screen !in setOf(
                    CockpitScreen.CONNECTION_DETAILS,
                    CockpitScreen.HOST_REVIEW,
                )
            ) {
                View.VISIBLE
            } else {
                View.GONE
            }
        attention.text = state.attention?.let {
            getString(
                R.string.attention_banner,
                it.project,
                statusText(it.status),
            )
        } ?: ""
    }

    private fun renderThreadDetail() {
        if (state.screen != CockpitScreen.THREAD) {
            findViewById<TextView>(R.id.thread_metadata).text = ""
            previewContent.removeAllViews()
            return
        }
        val session = state.selectedSession() ?: return
        findViewById<TextView>(R.id.thread_metadata).text = getString(
            R.string.thread_metadata,
            session.title,
            session.project,
            statusText(session.status),
        )
        findViewById<TextView>(R.id.preview_feedback).text = when {
            state.previewLoading -> getString(R.string.preview_loading)
            state.previewErrorCode != null ->
                getString(R.string.preview_error, errorText(state.previewErrorCode))
            state.preview != null -> getString(
                R.string.preview_loaded,
                state.preview!!.lines.size,
                state.preview!!.limit,
            )
            else -> getString(R.string.preview_explicit)
        }
        findViewById<Button>(R.id.preview_action).isEnabled = !state.previewLoading
        previewContent.removeAllViews()
        state.preview?.lines?.forEach { line ->
            previewContent.addView(TextView(this).apply {
                text = line
                setPadding(12, 8, 12, 8)
            })
        }
    }

    private fun renderConnectionDetails() {
        val detailText = findViewById<TextView>(R.id.connection_detail_text)
        val publicKeyText = findViewById<TextView>(R.id.public_key_text)
        if (state.screen != CockpitScreen.CONNECTION_DETAILS) {
            detailText.text = ""
            publicKeyText.text = ""
            return
        }
        val identity = persisted?.let { AndroidKeystoreP256Identity(it.id, it.keystoreAlias) }
        detailText.text = if (fixtureMode) {
            getString(R.string.fixture_profile_detail)
        } else {
            persisted?.let {
                getString(
                    R.string.connection_detail_value,
                    it.label,
                    it.user,
                    it.host,
                    it.port,
                    it.pin?.algorithm ?: getString(R.string.not_reviewed),
                    it.pin?.sha256 ?: getString(R.string.not_reviewed),
                )
            } ?: getString(R.string.profile_required_detail)
        }
        publicKeyText.text = if (!fixtureMode && identity?.exists() == true) {
            getString(R.string.public_key_value, identity.openSshPublicKey())
        } else if (!fixtureMode && persisted != null) {
            getString(R.string.identity_missing_detail)
        } else {
            ""
        }
        findViewById<LinearLayout>(R.id.profile_form).visibility =
            if (!fixtureMode && persisted == null) View.VISIBLE else View.GONE
        findViewById<Button>(R.id.create_profile).visibility =
            if (!fixtureMode && persisted == null) View.VISIBLE else View.GONE
        findViewById<Button>(R.id.repair_pin).visibility =
            if (!fixtureMode && persisted?.pin != null) View.VISIBLE else View.GONE
        findViewById<Button>(R.id.replace_identity).visibility =
            if (!fixtureMode && persisted != null && identity?.exists() == false) {
                View.VISIBLE
            } else {
                View.GONE
            }
        findViewById<Button>(R.id.delete_profile).visibility =
            if (!fixtureMode && persisted != null) View.VISIBLE else View.GONE
        findViewById<Button>(R.id.disconnect).visibility =
            if (state.phase in setOf(
                    ConnectionPhase.CONNECTED,
                    ConnectionPhase.CONNECTING,
                    ConnectionPhase.ERROR,
                )
            ) View.VISIBLE else View.GONE
    }

    private fun renderHostReview() {
        val details = findViewById<TextView>(R.id.host_review_details)
        details.text = if (state.screen == CockpitScreen.HOST_REVIEW) {
            state.hostKeyReview?.let {
                getString(
                    R.string.host_review_details,
                    it.algorithm,
                    it.sha256,
                )
            } ?: ""
        } else {
            ""
        }
    }

    private fun errorText(code: String?): String = getString(
        when (code) {
            "profile_required", "profile_invalid" -> R.string.error_profile
            "identity_missing" -> R.string.error_identity_missing
            "host_key_mismatch" -> R.string.error_host_key_mismatch
            "unsupported_host_key" -> R.string.error_unsupported_host_key
            "authentication_failed" -> R.string.error_authentication
            "ssh_connection_failed" -> R.string.error_ssh_connection
            "process_launch_failed" -> R.string.error_process_launch
            "fixture_unavailable", "fixture_connection_failed" -> R.string.error_fixture
            "preview_unavailable", "fixture_preview_unavailable" -> R.string.error_preview
            "refresh_unavailable", "connection_unavailable" -> R.string.error_refresh
            else -> R.string.error_protocol
        },
    )

    private fun statusText(status: ThreadStatus): String = getString(
        when (status) {
            ThreadStatus.WAITING_APPROVAL -> R.string.status_waiting_approval
            ThreadStatus.RUNNING, ThreadStatus.TOOL_RUNNING -> R.string.status_running
            ThreadStatus.DONE -> R.string.status_done
            ThreadStatus.UNKNOWN -> R.string.status_unknown
        },
    )

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onBackPressed() {
        if (state.screen == CockpitScreen.HOST_REVIEW) {
            disconnect(false)
        } else if (state.screen != CockpitScreen.HOME) {
            dispatch(CockpitEvent.OpenHome)
        } else {
            super.onBackPressed()
        }
    }

    override fun onStop() {
        disconnect(true)
        super.onStop()
    }

    override fun onDestroy() {
        stopPolling()
        (protocol as? ForegroundSshProtocolClient)?.dispose()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_FIXTURE_MODE = "dev.codexradar.FIXTURE_MODE"
        const val EXTRA_SYNTHETIC_THREADS = "dev.codexradar.SYNTHETIC_THREADS"
        private const val PREVIEW_LIMIT = 20
        private const val POLL_INTERVAL_MILLIS = 1_000L
    }
}
