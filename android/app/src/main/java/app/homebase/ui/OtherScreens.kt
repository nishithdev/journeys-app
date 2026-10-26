package app.homebase.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.homebase.BuildConfig
import app.homebase.HomebaseState
import androidx.compose.runtime.SideEffect
import androidx.core.view.WindowCompat
import app.homebase.Link
import app.homebase.MainActivity
import app.homebase.Screen
import app.homebase.Tailscale

@Composable
fun HomebaseRoot(state: HomebaseState, activity: MainActivity) {
    // Status bar icons: dark on the light screens, white over the dark top bar of an open app and the lock screen.
    val darkTop = state.locked || state.screen is Screen.App
    val darkBottom = state.locked
    SideEffect {
        WindowCompat.getInsetsController(activity.window, activity.window.decorView).apply {
            isAppearanceLightStatusBars = !darkTop
            isAppearanceLightNavigationBars = !darkBottom
        }
    }
    Box(Modifier.fillMaxSize().background(Ground)) {
        when (val s = state.screen) {
            is Screen.Setup -> SetupScreen(state, s.prefill)
            is Screen.Check -> CheckScreen(state, s.url)
            Screen.Launcher -> LauncherScreen(state, activity)
            is Screen.App -> AppScreen(state, activity, s.appId)
            is Screen.Offline -> OfflineScreen(state, s.appId)
            Screen.Settings -> SettingsScreen(state, activity)
        }
        if (state.locked) LockScreen(onUnlock = { activity.unlock() })
    }
}

@Composable
fun OfflineScreen(state: HomebaseState, appId: String?) {
    val ctx = LocalContext.current
    var opened by remember { mutableStateOf(false) }
    val tailscaleOff = state.link == Link.TailscaleOff || !Tailscale.vpnOn(ctx)
    BackHandler { state.screen = Screen.Launcher }
    // Back on the tailnet: carry on to where you were going.
    LaunchedEffect(state.link) {
        if (state.link == Link.Connected) state.screen = if (appId != null) Screen.App(appId) else Screen.Launcher
    }
    ScreenColumn(Modifier.windowInsetsPadding(WindowInsets.safeDrawing).verticalScroll(rememberScrollState())) {
        Spacer(Modifier.height(24.dp))
        Box(Modifier.size(72.dp).clip(RoundedCornerShape(24.dp)).background(WarnSoft), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Warning, contentDescription = null, tint = Warn, modifier = Modifier.size(36.dp))
        }
        Text(
            if (opened) "Waiting for Tailscale…" else if (tailscaleOff) "Tailscale is off" else "Can't reach ${state.current?.name ?: "the server"}",
            fontSize = 28.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 33.sp,
        )
        Text(
            when {
                opened -> "As soon as your phone is back on your tailnet, your apps open again. You can keep this screen open."
                tailscaleOff -> "Your homelab is only reachable through your tailnet, so Homebase can't connect right now."
                else -> "Tailscale is on, but the server didn't answer. It may be off or restarting." + if (state.linkNote.isNotBlank()) " (${state.linkNote})" else ""
            },
            fontSize = 15.sp, color = Muted, lineHeight = 22.sp,
        )
        Spacer(Modifier.weight(1f))
        if (tailscaleOff) PrimaryButton(if (opened) "Open Tailscale again" else "Open Tailscale", onClick = { opened = true; Tailscale.open(ctx) })
        SecondaryButton("Try again", onClick = { state.refresh() })
        if (appId != null) TextButton(onClick = { state.screen = Screen.App(appId) }, modifier = Modifier.fillMaxWidth()) {
            Text("Open ${state.app(appId)?.name ?: "the app"}'s saved copy", fontWeight = FontWeight.Bold)
        }
        Text(
            "Journeys works offline: changes are kept on the phone and sync once you're back.",
            fontSize = 12.sp, color = Faint, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp),
        )
    }
}

@Composable
fun LockScreen(onUnlock: () -> Unit) {
    LaunchedEffect(Unit) { onUnlock() }
    BackHandler { /* stay locked */ }
    Column(
        Modifier.fillMaxSize().background(Ink).clickable(enabled = true, onClick = {}).windowInsetsPadding(WindowInsets.safeDrawing).padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Spacer(Modifier.height(80.dp))
        Box(Modifier.size(64.dp).clip(RoundedCornerShape(20.dp)).background(Color.White), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Home, contentDescription = null, tint = Ink, modifier = Modifier.size(34.dp))
        }
        Text("Homebase is locked", color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
        Text("Your journeys, goals and Home Assistant stay private until you unlock.", color = Color(0xFFB7BDCC), fontSize = 15.sp, textAlign = TextAlign.Center, lineHeight = 22.sp)
        Spacer(Modifier.weight(1f))
        IconButton(
            onClick = onUnlock,
            modifier = Modifier.size(96.dp).clip(CircleShape).background(Color(0xFF1C2130)).border(2.dp, Accent, CircleShape),
        ) { Icon(Icons.Filled.Lock, contentDescription = "Unlock", tint = Color(0xFFAFC0FF), modifier = Modifier.size(40.dp)) }
        Text("Tap to unlock", color = Color(0xFFB7BDCC), fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
fun SettingsScreen(state: HomebaseState, activity: MainActivity) {
    val ctx = LocalContext.current
    val s = state.current
    var lock by remember { mutableStateOf(state.store.lockEnabled) }
    var warn by remember { mutableStateOf(state.store.warnTailscale) }
    var openOnLaunch by remember { mutableStateOf(state.store.openOnLaunch) }
    var launchMenu by remember { mutableStateOf(false) }
    var editingToken by remember { mutableStateOf(false) }
    var confirmForget by remember { mutableStateOf(false) }
    val canLock = remember { activity.canLock() }
    BackHandler { state.screen = Screen.Launcher }

    ScreenColumn(Modifier.windowInsetsPadding(WindowInsets.safeDrawing).verticalScroll(rememberScrollState())) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
            IconButton(onClick = { state.screen = Screen.Launcher }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
            Text("Settings", fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
        }

        if (s != null) {
            SectionLabel("Server")
            Panel {
                Text(s.name, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                Text(s.url, color = Muted, fontSize = 12.sp)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Access token", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        Text(if (state.token() != null) "•••••••••••• · stored securely on this phone" else "Not set", color = Muted, fontSize = 12.sp)
                    }
                    TextButton(onClick = { editingToken = true }) { Text(if (state.token() != null) "Change" else "Add", fontWeight = FontWeight.Bold) }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Open on launch", fontWeight = FontWeight.Bold, fontSize = 15.sp, modifier = Modifier.weight(1f))
                    Box {
                        TextButton(onClick = { launchMenu = true }) {
                            Text(if (openOnLaunch == "list") "App list" else state.app(openOnLaunch)?.name ?: "App list", fontWeight = FontWeight.Bold)
                        }
                        DropdownMenu(expanded = launchMenu, onDismissRequest = { launchMenu = false }) {
                            DropdownMenuItem(text = { Text("App list") }, onClick = { openOnLaunch = "list"; state.store.openOnLaunch = "list"; launchMenu = false })
                            state.apps.forEach { a ->
                                DropdownMenuItem(text = { Text(a.name) }, onClick = { openOnLaunch = a.id; state.store.openOnLaunch = a.id; launchMenu = false })
                            }
                        }
                    }
                }
            }
        }

        SectionLabel("Privacy and connection")
        Panel {
            ToggleRow(
                "Fingerprint lock",
                if (canLock) "Ask after 5 minutes away" else "Set up a screen lock on this phone first",
                lock && canLock, enabled = canLock,
            ) { lock = it; state.store.lockEnabled = it }
            ToggleRow("Tell me when Tailscale is off", "Instead of a blank page", warn) { warn = it; state.store.warnTailscale = it }
        }

        Panel {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                val on = Tailscale.vpnOn(ctx)
                StatusDot(if (on) Good else Bad, if (on) GoodSoft else BadSoft)
                Column(Modifier.weight(1f)) {
                    Text(if (on) "Tailscale connected" else if (Tailscale.installed(ctx)) "Tailscale is off" else "Tailscale isn't installed", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Text("Handled by the Tailscale app", color = Muted, fontSize = 12.sp)
                }
                TextButton(onClick = { Tailscale.open(ctx) }) { Text("Open", fontWeight = FontWeight.Bold) }
            }
        }

        Spacer(Modifier.weight(1f))
        if (s != null) SecondaryButton("Forget this server", onClick = { confirmForget = true }, color = Color(0xFFB42318))
        Text("Homebase ${BuildConfig.VERSION_NAME} · your data stays on your server", fontSize = 12.sp, color = Faint, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp))
    }

    if (editingToken) {
        var value by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { editingToken = false },
            title = { Text("Access token") },
            text = {
                OutlinedTextField(
                    value = value, onValueChange = { value = it }, label = { Text("APP_TOKEN from the server's .env") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                )
            },
            confirmButton = { TextButton(onClick = { state.changeToken(value); editingToken = false }, enabled = value.isNotBlank()) { Text("Save") } },
            dismissButton = { TextButton(onClick = { editingToken = false }) { Text("Cancel") } },
        )
    }
    if (confirmForget && s != null) {
        AlertDialog(
            onDismissRequest = { confirmForget = false },
            title = { Text("Forget ${s.name}?") },
            text = { Text("Removes the server, its token and its app list from this phone. Nothing on the server changes.") },
            confirmButton = { TextButton(onClick = { confirmForget = false; state.forgetCurrent() }) { Text("Forget", color = Color(0xFFB42318)) } },
            dismissButton = { TextButton(onClick = { confirmForget = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun ToggleRow(title: String, text: String, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.padding(vertical = 4.dp)) {
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text(text, color = Muted, fontSize = 12.sp)
        }
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled, colors = SwitchDefaults.colors(checkedTrackColor = Accent))
    }
}
