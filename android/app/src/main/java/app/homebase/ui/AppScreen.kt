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
import android.os.SystemClock
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.key
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.homebase.OpenStep
import app.homebase.Opening
import app.homebase.Problem
import app.homebase.Snapshots
import app.homebase.StepState
import app.homebase.Tailscale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
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
    val ctx = LocalContext.current
    var progress by remember { mutableIntStateOf(100) }
    var menu by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    // A new address (e.g. home Wi-Fi while Tailscale is off) means a fresh page at that address.
    val web = remember(app.id, state.routeVersion) { webViewFor(activity, state, app) }
    val viaWifi = state.urlFor(app) != app.url
    val hooks = web.tag as Hooks
    val serverUrl = state.current?.url ?: app.url
    val appOrigin = Model.origin(state.urlFor(app)) ?: app.url
    val isJourneys = app.icon == "journeys" || app.id == "journeys"

    // ---- what the loading screen shows
    var ready by remember(web) { mutableStateOf(hooks.ready) }
    var tailscale by remember(web) { mutableStateOf(StepState.Waiting) }
    var server by remember(web) { mutableStateOf(StepState.Waiting) }
    var serverMs by remember(web) { mutableStateOf(0L) }
    var page by remember(web) { mutableStateOf(if (hooks.ready) StepState.Done else StepState.Waiting) }
    var data by remember(web) { mutableStateOf(if (hooks.ready) StepState.Done else StepState.Waiting) }
    var problem by remember(web) { mutableStateOf<Problem?>(null) }
    var attempt by remember(web) { mutableIntStateOf(0) }
    val snapshot = remember(web) { if (hooks.ready) null else Snapshots.load(ctx, serverUrl, app.id) }
    val openedAt = remember(web) { SystemClock.elapsedRealtime() }
    remember(web) {
        state.remote.event(
            "app_open",
            "${app.name}" + (if (hooks.ready) " (already loaded)" else if (snapshot != null) " (showing last view)" else "") + if (viaWifi) " via home Wi-Fi" else "",
            mapOf("app" to app.id),
        )
        true
    }
    LaunchedEffect(problem) { problem?.let { state.remote.event("problem", "${app.name}: ${it.title}", mapOf("app" to app.id)) } }

    remember(web) {
        (web.webChromeClient as? HomebaseChrome)?.onProgress = { progress = it }
        hooks.onMainFrameError = { if (!hooks.ready) attempt++ } // look again at once, don't wait for a timeout
        true
    }

    // Steps 1 and 2: Tailscale, then the server. On trouble, say what's wrong and keep trying every 5 seconds.
    LaunchedEffect(web, attempt) {
        if (hooks.ready) return@LaunchedEffect
        val target = state.urlFor(app)
        val checkTs = state.store.warnTailscale && Opening.needsTailscale(target)
        val vpn = Tailscale.vpnOn(ctx)
        // Tailscale off isn't a failure yet: the name may work on home Wi-Fi too. Only the server's answer decides.
        tailscale = if (!checkTs) StepState.Skipped else if (vpn) StepState.Done else StepState.Working
        server = StepState.Working
        val ms = Opening.reach(target)
        if (ms != null) {
            server = StepState.Done; serverMs = ms; problem = null
            if (tailscale == StepState.Working) tailscale = StepState.Skipped // reached without it
            if (page == StepState.Waiting) page = StepState.Working
            return@LaunchedEffect
        }
        server = StepState.Failed
        if (tailscale == StepState.Working) tailscale = StepState.Failed
        val routed = app.copy(url = target)
        val srv = state.current?.let { it.copy(url = state.urlFor(it.url)) }
        problem = Opening.diagnose(ctx, routed, srv, state.store.warnTailscale)
        while (problem != null && !hooks.ready) {
            delay(5_000)
            val p = Opening.diagnose(ctx, routed, srv, state.store.warnTailscale)
            if (p == null) {
                problem = null
                web.reload() // it's back: load the page again instead of waiting on the failed one
                attempt++
                return@LaunchedEffect
            }
            problem = p
        }
    }

    // Steps 3 and 4: the app's page draws its first screen, then (Journeys) gets your data.
    LaunchedEffect(web) {
        if (hooks.ready) return@LaunchedEffect
        val script = Opening.pageScript(appOrigin)
        var drawnAt = 0L
        while (true) {
            val raw = suspendCancellableCoroutine<String?> { c -> web.evaluateJavascript(script) { c.resume(it) } }
            val ps = Opening.parsePage(raw)
            if (ps.here && ps.loaded && page != StepState.Done) { page = if (ps.drawn) StepState.Done else StepState.Working }
            if (ps.here && ps.loaded && ps.drawn) {
                page = StepState.Done
                if (drawnAt == 0L) drawnAt = SystemClock.elapsedRealtime()
                val dataBefore = data
                if (!isJourneys) data = StepState.Skipped
                else data = if (ps.dataDone) StepState.Done else StepState.Working
                // The app has drawn: show it. (Journeys shows its own "Syncing…" for the rest.)
                if (!hooks.ready) {
                    hooks.ready = true; ready = true; problem = null
                    val ms = SystemClock.elapsedRealtime() - openedAt
                    state.remote.event(
                        "app_ready",
                        "${app.name} drawn in ${"%.1f".format(ms / 1000.0)} s" + (if (serverMs > 0) " (server answered in $serverMs ms)" else "") + if (viaWifi) " via home Wi-Fi" else "",
                        mapOf("app" to app.id, "ms" to ms, "server_ms" to serverMs),
                    )
                }
                if (isJourneys && ps.dataDone && dataBefore != StepState.Done) {
                    state.remote.event("app_data", "${app.name} synced its data in ${"%.1f".format((SystemClock.elapsedRealtime() - openedAt) / 1000.0)} s · ${ps.sync}", mapOf("app" to app.id))
                }
                if (data != StepState.Working || SystemClock.elapsedRealtime() - drawnAt > 15_000) break
            }
            delay(200)
        }
    }

    // Keep a picture of the last screen for next time (when you leave the app or Homebase).
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(web) {
        fun keep() {
            if (!hooks.ready) return
            val bmp = Snapshots.capture(web) ?: return
            snapshotScope.launch { Snapshots.save(ctx, serverUrl, app.id, bmp) }
        }
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_STOP) keep() }
        lifecycle.addObserver(obs)
        onDispose { keep(); lifecycle.removeObserver(obs) }
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
                    val ok = problem == null && (state.link == Link.Connected || state.link == Link.HomeWifi)
                    Box(Modifier.size(7.dp).clip(CircleShape).background(if (ok) Color(0xFF3DDC97) else if (problem == null) Color(0xFFB7BDCC) else Color(0xFFFF8A7A)))
                    Text(
                        (state.current?.name ?: "") + when {
                            problem != null -> " · can't reach"
                            !ready -> " · opening"
                            viaWifi -> " · on home Wi-Fi"
                            ok -> " · connected"
                            state.link == Link.Checking -> " · checking"
                            else -> " · offline"
                        },
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
            key(web) {
                AndroidView(
                    factory = { (web.parent as? ViewGroup)?.removeView(web); web },
                    modifier = Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.navigationBars),
                )
            }
            val steps = buildList {
                if (tailscale != StepState.Skipped) add(OpenStep("Tailscale", tailscale, if (tailscale == StepState.Failed) "off" else ""))
                add(OpenStep(
                    "Reaching ${state.current?.name ?: Model.serverName(app.url)}" + if (viaWifi) " on home Wi-Fi" else "", server,
                    if (server == StepState.Done) "$serverMs ms" else "",
                ))
                add(OpenStep("Loading ${app.name}", page))
                if (isJourneys) add(OpenStep("Getting your data", data))
            }
            Cover(
                visible = !ready, app = app, steps = steps, problem = problem, snapshot = snapshot,
                onRetry = { problem = null; web.reload(); attempt++ },
                onTailscale = { Tailscale.open(ctx) },
                onBack = { state.screen = Screen.Launcher },
            )
        }
    }
}

/** Opens Homebase's WebView for [app], or the one it already has (kept while you switch, or loaded ahead). */
private fun webViewFor(activity: MainActivity, state: HomebaseState, app: HomeApp): WebView {
    val want = Model.origin(state.urlFor(app))
    state.webViews[app.id]?.let { w -> if ((w.tag as? Hooks)?.origin == want) return w; state.webViews.remove(app.id); w.destroy() }
    return createWebView(activity, state, app.copy(url = state.urlFor(app))).also { state.webViews[app.id] = it }
}

/**
 * Loads [app] in the background (your most-opened app, while you're on the launcher),
 * so tapping it shows a page that's already there.
 */
fun preloadApp(activity: MainActivity, state: HomebaseState, app: HomeApp) {
    if (state.webViews.containsKey(app.id)) return
    val web = webViewFor(activity, state, app)
    val origin = Model.origin(state.urlFor(app)) ?: return
    val hooks = web.tag as Hooks
    // Nothing draws it yet, so ask the page itself when it's ready.
    val script = Opening.pageScript(origin)
    fun check(left: Int) {
        if (left <= 0 || hooks.ready || state.webViews[app.id] !== web) return
        web.evaluateJavascript(script) { raw ->
            val ps = Opening.parsePage(raw)
            if (ps.here && ps.loaded && ps.drawn) hooks.ready = true else web.postDelayed({ check(left - 1) }, 300)
        }
    }
    web.postDelayed({ check(100) }, 300)
}

/** Snapshots are saved after the screen has gone, so they need a scope of their own. */
private val snapshotScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

/** Callbacks a WebView reports to whichever screen is showing it. */
private class Hooks {
    var onMainFrameError: () -> Unit = {}
    /** The app has drawn its first real screen (it stays true for this WebView). */
    var ready = false
    /** The address this WebView was opened at (its Tailscale or home Wi-Fi origin). */
    var origin: String? = null
}

/** A line about the apps Homebase knows. */
private fun aboutApp(app: HomeApp): String? = when {
    app.icon == "journeys" || app.id == "journeys" -> "Your life journeys, step by step, with the days between each step."
    app.icon == "quest" || app.id.contains("life-quest") -> "Your pixel skill tree for life. Finish a step to unlock the next."
    app.icon == "home" || app.id.contains("home-assistant") -> "Your home's lights, sensors and automations."
    else -> null
}

@Composable
private fun Cover(
    visible: Boolean, app: HomeApp, steps: List<OpenStep>, problem: Problem?, snapshot: Pair<Bitmap, Long>?,
    onRetry: () -> Unit, onTailscale: () -> Unit, onBack: () -> Unit,
) {
    AnimatedVisibility(visible = visible, enter = fadeIn(), exit = fadeOut(tween(260))) {
        if (snapshot != null) SnapshotCover(app, snapshot, steps, problem, onRetry, onTailscale, onBack)
        else LoadingCover(app, steps, problem, onRetry, onTailscale, onBack)
    }
}

/** The last screen you saw, at once, with a small "Updating…" card showing the steps (or what's wrong). */
@Composable
private fun SnapshotCover(
    app: HomeApp, snapshot: Pair<Bitmap, Long>, steps: List<OpenStep>, problem: Problem?,
    onRetry: () -> Unit, onTailscale: () -> Unit, onBack: () -> Unit,
) {
    Box(Modifier.fillMaxSize().background(Color.White).clickable(enabled = false) {}.semantics { contentDescription = "${app.name}, your last view, updating" }) {
        Image(
            snapshot.first.asImageBitmap(), contentDescription = null,
            modifier = Modifier.fillMaxSize(), contentScale = ContentScale.FillWidth, alignment = Alignment.TopCenter,
        )
        // Dim it a little so it reads as "not live yet".
        Box(Modifier.fillMaxSize().background(Color.White.copy(alpha = if (problem != null) 0.45f else 0.25f)))
        Column(
            Modifier.align(Alignment.BottomCenter).padding(16.dp).fillMaxWidth()
                .clip(RoundedCornerShape(20.dp)).background(Ink).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (problem == null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    CircularProgressIndicator(Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp)
                    Text("Updating your last view", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp, modifier = Modifier.weight(1f))
                    Text(sinceText(snapshot.second), color = Color(0xFFB7BDCC), fontSize = 12.sp)
                }
                StepsRow(steps)
            } else {
                Text(problem.title, color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 16.sp)
                Text("${problem.detail} Showing your last view from ${sinceText(snapshot.second)}.", color = Color(0xFFD5D9E3), fontSize = 13.sp, lineHeight = 19.sp)
                ProblemButtons(problem, onRetry, onTailscale, onBack, Color.White)
            }
        }
    }
}

/** No saved view yet: the app's colour, icon, what it is, its latest summary and the steps. */
@Composable
private fun LoadingCover(
    app: HomeApp, steps: List<OpenStep>, problem: Problem?,
    onRetry: () -> Unit, onTailscale: () -> Unit, onBack: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().background(Color(app.color)).clickable(enabled = false) {}.verticalScroll(rememberScrollState()).padding(32.dp)
            .semantics { contentDescription = "Opening ${app.name}" },
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
    ) {
        Spacer(Modifier.height(24.dp))
        Box(Modifier.size(96.dp).clip(RoundedCornerShape(28.dp)).background(Color.White.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
            AppIcon(app, size = 72.dp)
        }
        Text(app.name, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
        aboutApp(app)?.let { Text(it, color = Color.White.copy(alpha = 0.75f), fontSize = 14.sp, textAlign = TextAlign.Center, lineHeight = 20.sp) }
        // Something to read while it loads: the app's own summary from the launcher tile.
        if (problem == null && (app.subtitle.isNotBlank() || app.badge > 0)) Column(
            Modifier.clip(RoundedCornerShape(16.dp)).background(Color.White.copy(alpha = 0.12f)).padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (app.badge > 0) Text(
                "${app.badge} thing${if (app.badge == 1) "" else "s"} waiting for you",
                color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold,
            )
            if (app.subtitle.isNotBlank()) Text(app.subtitle, color = Color.White.copy(alpha = 0.85f), fontSize = 13.sp, textAlign = TextAlign.Center)
        }
        if (problem == null) {
            Column(
                Modifier.clip(RoundedCornerShape(16.dp)).background(Color.Black.copy(alpha = 0.18f)).padding(horizontal = 18.dp, vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) { steps.forEach { StepLine(it) } }
        } else {
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color.Black.copy(alpha = 0.22f)).padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(problem.title, color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 17.sp, textAlign = TextAlign.Center)
                Text(problem.detail, color = Color.White.copy(alpha = 0.85f), fontSize = 13.sp, lineHeight = 19.sp, textAlign = TextAlign.Center)
                ProblemButtons(problem, onRetry, onTailscale, onBack, Color.White)
            }
        }
    }
}

@Composable
private fun ProblemButtons(problem: Problem, onRetry: () -> Unit, onTailscale: () -> Unit, onBack: () -> Unit, color: Color) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        if (problem is Problem.TailscaleOff) TextButton(onClick = onTailscale) { Text("Open Tailscale", color = color, fontWeight = FontWeight.Bold) }
        TextButton(onClick = onRetry) { Text("Try again", color = color, fontWeight = FontWeight.Bold) }
        TextButton(onClick = onBack) { Text("Back to apps", color = color.copy(alpha = 0.8f)) }
    }
}

/** "✓ Tailscale   ✓ Reaching alpha5 · 42 ms   ◌ Loading Journeys   · Getting your data" */
@Composable
private fun StepLine(step: OpenStep) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        StepMark(step.state, Modifier.size(18.dp))
        Text(
            step.label + if (step.note.isNotBlank()) " · ${step.note}" else "",
            color = if (step.state == StepState.Waiting) Color.White.copy(alpha = 0.55f) else Color.White,
            fontSize = 14.sp, fontWeight = if (step.state == StepState.Working) FontWeight.Bold else FontWeight.Normal,
        )
    }
}

@Composable
private fun StepsRow(steps: List<OpenStep>) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        steps.forEach { s ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StepMark(s.state, Modifier.size(14.dp))
                Text(
                    s.label + if (s.note.isNotBlank()) " · ${s.note}" else "",
                    color = if (s.state == StepState.Waiting) Color(0xFF7D8496) else Color(0xFFE7EAF1), fontSize = 12.sp,
                )
            }
        }
    }
}

@Composable
private fun StepMark(st: StepState, modifier: Modifier) {
    Box(modifier, contentAlignment = Alignment.Center) {
        when (st) {
            StepState.Done -> Box(Modifier.fillMaxSize().clip(CircleShape).background(Color(0xFF3DDC97)), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Check, contentDescription = "done", tint = Ink, modifier = Modifier.fillMaxSize(0.75f))
            }
            StepState.Working -> CircularProgressIndicator(Modifier.fillMaxSize(), color = Color.White, strokeWidth = 2.dp)
            StepState.Failed -> Box(Modifier.fillMaxSize().clip(CircleShape).background(Color(0xFFFF8A7A)), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Close, contentDescription = "failed", tint = Ink, modifier = Modifier.fillMaxSize(0.75f))
            }
            else -> Box(Modifier.fillMaxSize(0.45f).clip(CircleShape).background(Color.White.copy(alpha = 0.35f)))
        }
    }
}

private fun sinceText(at: Long): String {
    val mins = ((System.currentTimeMillis() - at) / 60_000).coerceAtLeast(0)
    return when {
        mins < 1 -> "just now"
        mins < 60 -> "$mins min ago"
        mins < 24 * 60 -> "${mins / 60} h ago"
        else -> java.text.DateFormat.getDateInstance(java.text.DateFormat.MEDIUM).format(java.util.Date(at))
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
    hooks.origin = Model.origin(app.url)
    web.tag = hooks
    with(web.settings) {
        javaScriptEnabled = true
        domStorageEnabled = true // localStorage: the apps keep their offline queue and settings here
        cacheMode = WebSettings.LOAD_DEFAULT
        mediaPlaybackRequiresUserGesture = true
        userAgentString = "$userAgentString Homebase/${BuildConfig.VERSION_NAME}"
    }
    // Pages that belong to this server (or this app) stay inside; anything else opens in the browser.
    val inside = setOfNotNull(Model.origin(app.url), state.current?.url?.let { Model.origin(it) }, state.current?.url?.let { Model.origin(state.urlFor(it)) })
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
        }
    }
    web.webChromeClient = HomebaseChrome(activity)
    web.setDownloadListener { url, _, _, _, _ -> runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }
    web.loadUrl(app.url)
    return web
}
