package app.homebase.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.homebase.Found
import app.homebase.Model

/** "alpha5 · port 3000 · also 192.168.1.20" */
fun Found.where(): String {
    val also = alts.map { Model.host(it) }.filter { it != host }.distinct()
    return "$host · port $port" + if (also.isNotEmpty()) " · also ${also.joinToString()}" else ""
}

/** One found service: its icon, name, where it runs, and what it is. */
@Composable
fun FoundRow(f: Found, onClick: () -> Unit, role: Role = Role.Button, trailing: @Composable () -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().clickable(role = role, onClickLabel = "Use ${f.name}", onClick = onClick).padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        AppIcon(f.toApp(), size = 40.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(f.name, fontWeight = FontWeight.Bold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                listOf(f.where(), f.subtitle).filter { it.isNotBlank() }.joinToString(" · "),
                color = Muted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
        }
        trailing()
    }
}

/** A titled panel of found services, with a spinner while looking and a button to look again. */
@Composable
fun FoundPanel(
    title: String,
    items: List<Found>,
    scanning: Boolean,
    empty: String,
    onRescan: () -> Unit,
    row: @Composable (Found) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SectionLabel(title, Modifier.weight(1f))
            if (scanning) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Accent)
            else IconButton(onClick = onRescan, modifier = Modifier.size(36.dp)) { Icon(Icons.Filled.Refresh, contentDescription = "Look again", tint = Muted) }
        }
        Panel(padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 4.dp)) {
            if (items.isEmpty()) Text(if (scanning) "Looking…" else empty, color = Muted, fontSize = 13.sp, lineHeight = 19.sp, modifier = Modifier.padding(vertical = 12.dp))
            items.forEach { row(it) }
        }
    }
}
