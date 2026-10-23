package app.homebase.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import kotlinx.coroutines.delay
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import app.homebase.BuildConfig
import app.homebase.HomeApp
import app.homebase.HomebaseState
import app.homebase.Link
import app.homebase.MainActivity
import app.homebase.Model
import app.homebase.Screen

@Composable
fun AppScreen(state: HomebaseState, activity: MainActivity, appId: String) {
    val app = state.app(appId)
    if (app == null) { state.screen = Screen.Launcher; return }
    var progress by remember { mutableIntStateOf(100) }
    var menu by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    val web = remember(app.id) {
        state.webViews.getOrPut(app.id) { createWebView(activity, state, app) }
    }
    // Progress and errors come from the WebView's clients; point them at this screen.
    val hooks = web.tag as? Hooks
    // Until the page has drawn something, show a loading screen in the app's colour instead of a blank WebView.
    var shown by remember(web) { mutableStateOf(hooks?.shown ?: true) }
    remember(web) {
        (web.webChromeClient as? HomebaseChrome)?.onProgress = { progress = it }
        hooks?.onMainFrameError = { if (state.store.warnTailscale && state.link != Link.Connected) state.screen = Screen.Offline(app.id) }
        hooks?.onShown = { shown = true }
        true
    }

    BackHandler {
        if (web.canGoBack()) web.goBack() else state.screen = Screen.Launcher
    }

    Column(Modifier.fillMaxSize().background(Color.White)) {
        Row(
            Modifier.fillMaxWidth().background(Ink).windowInsetsPadding(WindowInsets.statusBars).padding(start = 4.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { state.screen = Screen.Launcher }) { Icon(Icons.Filled.Menu, contentDescription = "Back to your apps", tint = Color.White) }
            Column(Modifier.weight(1f)) {
                Text(app.name, color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    val ok = state.link == Link.Connected
                    Box(Modifier.size(7.dp).clip(CircleShape).background(if (ok) Color(0xFF3DDC97) else Color(0xFFFF8A7A)))
                    Text(
                        (state.current?.name ?: "") + if (ok) " · connected" else if (state.link == Link.Checking) " · checking" else " · offline",
                        color = Color(0xFFB7BDCC), fontSize = 11.sp,
                    )
                }
            }
            IconButton(onClick = { web.reload() }) { Icon(Icons.Filled.Refresh, contentDescription = "Reload", tint = Color.White) }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "More options", tint = Color.White) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("Open in browser") }, onClick = {
                        menu = false
                        activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(web.url ?: app.url)))
                    })
                    DropdownMenuItem(text = { Text("Copy link") }, onClick = { menu = false; clipboard.setText(AnnotatedString(web.url ?: app.url)) })
                    DropdownMenuItem(text = { Text("Back to the app's start") }, onClick = { menu = false; web.loadUrl(app.url) })
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(3.dp).background(Ink)) {
            if (progress < 100) LinearProgressIndicator(progress = { progress / 100f }, modifier = Modifier.fillMaxSize(), color = Accent, trackColor = Color(0xFF2A2F3B))
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            AndroidView(
                factory = { (web.parent as? ViewGroup)?.removeView(web); web },
                modifier = Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.navigationBars),
            )
            Cover(visible = !shown, app = app, server = state.current?.name ?: "", onReload = { web.reload() }, onBack = { state.screen = Screen.Launcher })
        }
    }
}

/** Callbacks a WebView reports to whichever screen is showing it. */
private class Hooks {
    var onMainFrameError: () -> Unit = {}
    /** The page has drawn its first frame (it stays true for this WebView). */
    var shown = false
    var onShown: () -> Unit = {}
}

/** A line about the apps Homebase knows. */
private fun aboutApp(app: HomeApp): String? = when {
    app.icon == "journeys" || app.id == "journeys" -> "Your life journeys, step by step, with the days between each step."
    app.icon == "quest" || app.id.contains("life-quest") -> "Your pixel skill tree for life. Finish a step to unlock the next."
    app.icon == "home" || app.id.contains("home-assistant") -> "Your home's lights, sensors and automations."
    else -> null
}

@Composable
private fun Cover(visible: Boolean, app: HomeApp, server: String, onReload: () -> Unit, onBack: () -> Unit) {
    AnimatedVisibility(visible = visible, enter = fadeIn(), exit = fadeOut(tween(260))) {
        LoadingCover(app, server, onReload, onBack)
    }
}

/** Fills the wait while an app's page loads: its icon, colour and latest summary, then a hint if it takes long. */
@Composable
private fun LoadingCover(app: HomeApp, server: String, onReload: () -> Unit, onBack: () -> Unit) {
    var slow by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { delay(8_000); slow = true }
    Column(
        Modifier.fillMaxSize().background(Color(app.color)).clickable(enabled = false) {}.padding(32.dp)
            .semantics { contentDescription = "Opening ${app.name}" },
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
    ) {
        Box(Modifier.size(96.dp).clip(RoundedCornerShape(28.dp)).background(Color.White.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
            AppIcon(app, size = 72.dp)
        }
        Text(app.name, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
        aboutApp(app)?.let { Text(it, color = Color.White.copy(alpha = 0.75f), fontSize = 14.sp, textAlign = TextAlign.Center, lineHeight = 20.sp) }
        // Something to read while it loads: the app's own summary from the launcher tile.
        if (app.subtitle.isNotBlank() || app.badge > 0) Column(
            Modifier.clip(RoundedCornerShape(16.dp)).background(Color.White.copy(alpha = 0.12f)).padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (app.badge > 0) Text(
                "${app.badge} thing${if (app.badge == 1) "" else "s"} waiting for you",
                color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold,
            )
            if (app.subtitle.isNotBlank()) Text(app.subtitle, color = Color.White.copy(alpha = 0.85f), fontSize = 13.sp, textAlign = TextAlign.Center)
        }
        LinearProgressIndicator(
            modifier = Modifier.width(140.dp).height(4.dp).clip(RoundedCornerShape(2.dp)),
            color = Color.White, trackColor = Color.White.copy(alpha = 0.2f),
        )
        Text(
            if (slow) "Still loading. Your server is answering slowly, or Tailscale is reconnecting." else if (server.isNotBlank()) "Opening on $server" else "Opening",
            color = Color.White.copy(alpha = 0.8f), fontSize = 13.sp, textAlign = TextAlign.Center, lineHeight = 19.sp,
        )
        if (slow) Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            TextButton(onClick = onReload) { Text("Reload", color = Color.White, fontWeight = FontWeight.Bold) }
            TextButton(onClick = onBack) { Text("Back to apps", color = Color.White, fontWeight = FontWeight.Bold) }
        }
    }
}

private class HomebaseChrome(private val activity: MainActivity) : WebChromeClient() {
    var onProgress: (Int) -> Unit = {}
    override fun onProgressChanged(view: WebView, newProgress: Int) = onProgress(newProgress)
    override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean =
        activity.chooseFiles(callback, params)
}

@SuppressLint("SetJavaScriptEnabled")
private fun createWebView(activity: MainActivity, state: HomebaseState, app: HomeApp): WebView {
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    val web = WebView(activity)
    val hooks = Hooks()
    web.tag = hooks
    with(web.settings) {
        javaScriptEnabled = true
        domStorageEnabled = true // localStorage: the apps keep their offline queue and settings here
        cacheMode = WebSettings.LOAD_DEFAULT
        mediaPlaybackRequiresUserGesture = true
        userAgentString = "$userAgentString Homebase/${BuildConfig.VERSION_NAME}"
    }
    // Pages that belong to this server (or this app) stay inside; anything else opens in the browser.
    val inside = setOfNotNull(Model.origin(app.url), state.current?.url?.let { Model.origin(it) })
    val token = if (app.injectToken) state.token() else null
    val origin = Model.origin(app.url)
    if (token != null && origin != null) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, Model.tokenScript(token), setOf(origin))
        }
    }
    // Behind the page while it loads: the app's colour, never a white flash.
    web.setBackgroundColor(app.color.toInt())
    web.webViewClient = object : WebViewClient() {
        override fun onPageCommitVisible(view: WebView, url: String?) {
            if (!hooks.shown) { hooks.shown = true; hooks.onShown() }
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val o = Model.origin(request.url.toString())
            if (o != null && o in inside) return false
            runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            // Older WebViews without document-start scripts: hand over the token as the page starts.
            if (token != null && origin != null && !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) &&
                url != null && Model.origin(url) == origin
            ) view.evaluateJavascript(Model.tokenScript(token), null)
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) hooks.onMainFrameError()
            // An error page is something to see: don't keep it hidden behind the cover.
            if (request.isForMainFrame && !hooks.shown) { hooks.shown = true; hooks.onShown() }
        }
    }
    web.webChromeClient = HomebaseChrome(activity)
    web.setDownloadListener { url, _, _, _, _ -> runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }
    web.loadUrl(app.url)
    return web
}
