package app.homebase.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.homebase.HomeApp
import app.homebase.HomebaseState
import app.homebase.Link
import app.homebase.Screen

@Composable
fun LauncherScreen(state: HomebaseState) {
    var adding by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<HomeApp?>(null) }

    LazyVerticalGrid(
        columns = GridCells.Adaptive(minSize = 160.dp),
        modifier = Modifier.fillMaxSize().background(Ground).windowInsetsPadding(WindowInsets.safeDrawing),
        contentPadding = PaddingValues(20.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Homebase", fontSize = 30.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.weight(1f))
                IconButton(
                    onClick = { state.screen = Screen.Settings },
                    modifier = Modifier.size(48.dp).clip(CircleShape).background(Color.White).border(1.dp, Line, CircleShape),
                ) { Icon(Icons.Filled.Settings, contentDescription = "Settings") }
            }
        }
        item(span = { GridItemSpan(maxLineSpan) }) { ServerChip(state) }
        items(state.apps, key = { it.id }) { app ->
            AppTile(app, onOpen = { state.openApp(app.id) }, onLongPress = { if (app.manual) removing = app })
        }
        item { AddTile { adding = true } }
        if (state.apps.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) {
            Text("No apps yet. Pull them from your server by checking the connection, or add an address yourself.", color = Muted, fontSize = 13.sp)
        }
    }

    if (adding) AddAppDialog(onDismiss = { adding = false }, onAdd = { name, url -> state.addManualApp(name, url).also { if (it) adding = false } })
    removing?.let { app ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text("Remove ${app.name}?") },
            text = { Text("It's only removed from this launcher.") },
            confirmButton = { TextButton(onClick = { state.removeManualApp(app.id); removing = null }) { Text("Remove") } },
            dismissButton = { TextButton(onClick = { removing = null }) { Text("Cancel") } },
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ServerChip(state: HomebaseState) {
    var open by remember { mutableStateOf(false) }
    val s = state.current ?: return
    val (dot, halo, line) = when (state.link) {
        Link.Connected -> Triple(Good, GoodSoft, "Connected · ${state.linkMs} ms")
        Link.Checking, Link.Unknown -> Triple(Faint, Line, "Checking…")
        Link.TailscaleOff -> Triple(Bad, BadSoft, "Tailscale is off")
        Link.Unreachable -> Triple(Bad, BadSoft, "Can't reach the server")
        Link.NeedsToken -> Triple(Warn, WarnSoft, "Access token needed · open Settings")
    }
    Box {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).border(1.dp, Line, RoundedCornerShape(18.dp))
                .combinedClickable(onClick = { open = true }, onLongClick = { state.refresh() })
                .semantics { contentDescription = "${s.name}, $line. Switch server" }
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            StatusDot(dot, halo)
            Column(Modifier.weight(1f)) {
                Text(s.name, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                Text(line, color = Muted, fontSize = 12.sp)
            }
            Icon(Icons.Filled.ArrowDropDown, contentDescription = null, tint = Faint)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            state.servers.forEach { srv ->
                DropdownMenuItem(
                    text = { Text(if (srv.url == s.url) "${srv.name}  ·  current" else srv.name, fontWeight = if (srv.url == s.url) FontWeight.Bold else FontWeight.Normal) },
                    onClick = { open = false; if (srv.url != s.url) state.switchServer(srv) },
                )
            }
            DropdownMenuItem(text = { Text("Check connection") }, onClick = { open = false; state.refresh() })
            DropdownMenuItem(text = { Text("+ Add a server", color = Accent, fontWeight = FontWeight.Bold) }, onClick = { open = false; state.screen = Screen.Setup() })
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun AppTile(app: HomeApp, onOpen: () -> Unit, onLongPress: () -> Unit) {
    Column(
        Modifier.heightIn(min = 150.dp).clip(RoundedCornerShape(22.dp)).background(Color.White).border(1.dp, Line, RoundedCornerShape(22.dp))
            .combinedClickable(onClick = onOpen, onLongClick = onLongPress, onClickLabel = "Open ${app.name}")
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
            AppIcon(app)
            if (app.badge > 0) Box(
                Modifier.heightIn(min = 24.dp).widthIn(min = 24.dp).clip(RoundedCornerShape(12.dp)).background(Color(0xFFE8833A)).padding(horizontal = 7.dp),
                contentAlignment = Alignment.Center,
            ) { Text("${app.badge}", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold) }
        }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(app.name, fontWeight = FontWeight.ExtraBold, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(app.subtitle.ifBlank { app.url.substringAfter("://") }, color = Muted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun AddTile(onClick: () -> Unit) {
    val dash = Color(0xFFC9CEDA)
    Column(
        Modifier.heightIn(min = 150.dp).clip(RoundedCornerShape(22.dp))
            .drawBehind {
                drawRoundRect(dash, style = Stroke(width = 2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(12f, 10f))), cornerRadius = CornerRadius(22.dp.toPx()))
            }
            .combinedClickable(onClick = onClick, onClickLabel = "Add an app")
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(52.dp).clip(RoundedCornerShape(16.dp)).background(Color(0xFFE6E9F1)), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Add, contentDescription = null, tint = Ink)
        }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("Add an app", fontWeight = FontWeight.ExtraBold, fontSize = 16.sp)
            Text("Any address on your tailnet", color = Muted, fontSize = 12.sp)
        }
    }
}

@Composable
private fun AddAppDialog(onDismiss: () -> Unit, onAdd: (String, String) -> Boolean) {
    var name by remember { mutableStateOf("") }
    var url by remember { mutableStateOf("http://") }
    var error by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add an app") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(
                    value = url, onValueChange = { url = it; error = false }, label = { Text("Address") }, singleLine = true, isError = error,
                    supportingText = { Text(if (error) "That doesn't look like an address." else "e.g. http://alpha5:8123") }, modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = { TextButton(onClick = { if (!onAdd(name, url)) error = true }) { Text("Add") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
