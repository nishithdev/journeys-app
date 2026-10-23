package app.homebase.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Home
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.homebase.HomebaseState
import app.homebase.Model
import app.homebase.Net
import app.homebase.Screen
import app.homebase.Tailscale

@Composable
fun SetupScreen(state: HomebaseState, prefill: String) {
    val ctx = LocalContext.current
    var url by rememberSaveable { mutableStateOf(prefill.ifBlank { "http://" }) }
    var error by remember { mutableStateOf("") }
    val vpn = remember { Tailscale.vpnOn(ctx) }
    val installed = remember { Tailscale.installed(ctx) }
    BackHandler(enabled = state.current != null) { state.screen = Screen.Launcher }

    ScreenColumn(Modifier.windowInsetsPadding(WindowInsets.safeDrawing).imePadding().verticalScroll(rememberScrollState())) {
        Spacer(Modifier.height(24.dp))
        Box(Modifier.size(56.dp).clip(RoundedCornerShape(18.dp)).background(Ink), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Home, contentDescription = null, tint = Color.White, modifier = Modifier.size(30.dp))
        }
        Text("Connect your homelab", fontSize = 30.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 34.sp)
        Text(
            "Enter your server's address. Homebase opens the apps it hosts, like Journeys and Home Assistant, right here.",
            fontSize = 15.sp, color = Muted, lineHeight = 22.sp,
        )
        OutlinedTextField(
            value = url, onValueChange = { url = it; error = "" },
            label = { Text("Server address") },
            placeholder = { Text("http://alpha5.your-tailnet.ts.net:8080") },
            singleLine = true, isError = error.isNotEmpty(),
            supportingText = { Text(error.ifEmpty { "Your Tailscale name works best. An IP like 100.64.0.5:8080 works too." }) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { connect(state, url) { error = it } }),
            shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth(),
        )
        Panel {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                StatusDot(if (vpn) Good else Warn, if (vpn) GoodSoft else WarnSoft)
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(if (vpn) "Tailscale is on" else if (installed) "Tailscale is off" else "Tailscale isn't installed", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Text(
                        if (vpn) "Your phone can reach your tailnet. Homebase uses the Tailscale app for the connection."
                        else "Turn on Tailscale to reach a server on your tailnet. A server on your home Wi-Fi works without it.",
                        fontSize = 13.sp, color = Muted, lineHeight = 19.sp,
                    )
                    if (!vpn) TextButton(onClick = { Tailscale.open(ctx) }, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
                        Text(if (installed) "Open Tailscale" else "Get Tailscale", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
        Spacer(Modifier.weight(1f))
        PrimaryButton("Connect", onClick = { connect(state, url) { error = it } })
        Spacer(Modifier.height(16.dp))
    }
}

private fun connect(state: HomebaseState, url: String, onError: (String) -> Unit) {
    if (Model.normalizeUrl(url) == null) onError("That doesn't look like an address. Try http://alpha5:8080")
    else state.startCheck(url)
}

@Composable
fun CheckScreen(state: HomebaseState, url: String) {
    BackHandler { state.screen = Screen.Setup(url) }
    val r = state.checkResult
    ScreenColumn(Modifier.windowInsetsPadding(WindowInsets.safeDrawing).imePadding().verticalScroll(rememberScrollState())) {
        IconButton(onClick = { state.screen = Screen.Setup(url) }, modifier = Modifier.padding(top = 8.dp)) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                when {
                    state.checking -> "Checking…"
                    r is Net.Check.Ok -> "Found ${r.serverName}"
                    r is Net.Check.NeedsToken || r is Net.Check.BadToken -> "Enter your access token"
                    else -> "Can't reach the server"
                },
                fontSize = 26.sp, fontWeight = FontWeight.ExtraBold,
            )
            Text(url.substringAfter("://"), fontSize = 14.sp, color = Muted)
        }

        if (state.checking) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 3.dp, color = Accent)
                Text("Reaching your server…", color = Muted)
            }
        }

        when (r) {
            is Net.Check.Ok -> {
                Panel(padding = androidx.compose.foundation.layout.PaddingValues(vertical = 6.dp, horizontal = 16.dp)) {
                    CheckRow(true, "Reached your server", "Answered in ${r.ms} ms.")
                    if (state.checkToken.isNotBlank()) CheckRow(true, "Access token accepted", "Saved in Android's secure storage, not in the web page.")
                    CheckRow(true, "Found ${r.apps.size} app${if (r.apps.size == 1) "" else "s"}", r.apps.joinToString(", ") { it.name })
                    if (!r.https) CheckRow(false, "Plain http", "Fine inside your tailnet, which is encrypted. Set up HTTPS later to install apps offline.")
                }
                Spacer(Modifier.weight(1f))
                PrimaryButton("Continue", onClick = { state.saveServer(url, r) })
            }
            Net.Check.NeedsToken, Net.Check.BadToken -> {
                Text(
                    if (r == Net.Check.BadToken) "That token wasn't accepted. It's the APP_TOKEN in your server's .env." else "This server needs its APP_TOKEN, from the server's .env. It's kept encrypted on this phone.",
                    color = if (r == Net.Check.BadToken) Bad else Muted, fontSize = 14.sp, lineHeight = 20.sp,
                )
                OutlinedTextField(
                    value = state.checkToken, onValueChange = { state.checkToken = it }, label = { Text("Access token") },
                    singleLine = true, visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { state.runCheck(url) }),
                    shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.weight(1f))
                PrimaryButton("Check again", onClick = { state.runCheck(url) }, enabled = state.checkToken.isNotBlank())
            }
            is Net.Check.Unreachable -> {
                Panel {
                    Text("Nothing answered at this address.", fontWeight = FontWeight.Bold)
                    Text("Check that Tailscale is on, the address and port are right, and the server is running.", color = Muted, fontSize = 14.sp, lineHeight = 20.sp)
                    Text(r.reason, color = Faint, fontSize = 12.sp)
                }
                Spacer(Modifier.weight(1f))
                PrimaryButton("Try again", onClick = { state.runCheck(url) })
            }
            null -> {}
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun CheckRow(ok: Boolean, title: String, text: String) {
    Row(Modifier.padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.size(28.dp).clip(CircleShape).background(if (ok) GoodSoft else WarnSoft), contentAlignment = Alignment.Center) {
            Text(if (ok) "✓" else "!", color = if (ok) Color(0xFF1E7A4F) else Warn, fontWeight = FontWeight.ExtraBold)
        }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text(text, color = Muted, fontSize = 13.sp, lineHeight = 19.sp)
        }
    }
}
