package dev.codexradar.cockpit

import android.content.Context
import android.graphics.Typeface
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.TextView
import dev.codexradar.cockpit.domain.CockpitRow
import dev.codexradar.cockpit.domain.RadarSession

/** Platform ListView adapter: attached row views stay bounded as data grows. */
class CockpitListAdapter(
    private val context: Context,
    private val onRow: (CockpitRow) -> Unit,
) : BaseAdapter() {
    private var rows: List<CockpitRow> = emptyList()

    fun submit(value: List<CockpitRow>) {
        rows = value
        notifyDataSetChanged()
    }

    override fun getCount(): Int = rows.size
    override fun getItem(position: Int): CockpitRow = rows[position]
    override fun getItemId(position: Int): Long = position.toLong()
    override fun getViewTypeCount(): Int = 2
    override fun getItemViewType(position: Int): Int =
        if (rows[position] is CockpitRow.Header) 0 else 1
    override fun isEnabled(position: Int): Boolean =
        rows[position] is CockpitRow.Thread || rows[position] is CockpitRow.Project

    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
        val row = rows[position]
        val textView = (convertView as? TextView) ?: TextView(context).apply {
            minHeight = dp(52)
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(8), dp(16), dp(8))
        }
        when (row) {
            is CockpitRow.Header -> {
                textView.text = when (row.section) {
                    CockpitRow.Section.ATTENTION ->
                        context.getString(R.string.section_attention, row.count)
                    CockpitRow.Section.RUNNING ->
                        context.getString(R.string.section_running, row.count)
                    CockpitRow.Section.PROJECTS ->
                        context.getString(R.string.section_projects, row.count)
                    CockpitRow.Section.ARCHIVED ->
                        context.getString(R.string.section_archived, row.count)
                }
                textView.contentDescription = textView.text
                textView.textSize = 14f
                textView.setTypeface(null, Typeface.BOLD)
                textView.setOnClickListener(null)
                textView.isClickable = false
            }
            is CockpitRow.Project -> {
                textView.text = context.getString(R.string.project_row, row.name, row.count)
                textView.contentDescription =
                    context.getString(R.string.open_project_description, row.name)
                textView.textSize = 17f
                textView.setTypeface(null, Typeface.BOLD)
                textView.setOnClickListener { onRow(row) }
            }
            is CockpitRow.Thread -> {
                textView.text = context.getString(
                    R.string.thread_row,
                    row.session.title,
                    statusText(row.session),
                )
                textView.contentDescription =
                    context.getString(R.string.open_thread_description, row.session.title)
                textView.textSize = 16f
                textView.setTypeface(null, Typeface.NORMAL)
                textView.setOnClickListener { onRow(row) }
            }
            CockpitRow.Empty -> {
                textView.text = context.getString(R.string.empty_list)
                textView.contentDescription = textView.text
                textView.textSize = 15f
                textView.setTypeface(null, Typeface.NORMAL)
                textView.setOnClickListener(null)
                textView.isClickable = false
            }
        }
        return textView
    }

    private fun statusText(session: RadarSession): String = when (session.status) {
        dev.codexradar.cockpit.domain.ThreadStatus.WAITING_APPROVAL ->
            context.getString(R.string.status_waiting_approval)
        dev.codexradar.cockpit.domain.ThreadStatus.RUNNING,
        dev.codexradar.cockpit.domain.ThreadStatus.TOOL_RUNNING ->
            context.getString(R.string.status_running)
        dev.codexradar.cockpit.domain.ThreadStatus.DONE ->
            context.getString(R.string.status_done)
        dev.codexradar.cockpit.domain.ThreadStatus.UNKNOWN ->
            context.getString(R.string.status_unknown)
    }

    private fun dp(value: Int): Int =
        (value * context.resources.displayMetrics.density).toInt()
}
