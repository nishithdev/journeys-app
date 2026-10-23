package app.homebase

import android.content.Context
import android.os.SystemClock
import android.webkit.WebView
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

sealed interface Screen {
    data class Setup(val prefill: String = "") : Screen
    data class Check(val url: String) : Screen
    data object Launcher : Screen
    data class App(val appId: String) : Screen
    data class Offline(val appId: String?) : Screen
    data object Settings : Screen
}

enum class Link { Unknown, Checking, Connected, TailscaleOff, Unreachable, NeedsToken }

/** Everything the screens show, in one place. Survives screen changes; not process death (it reloads from [Store]). */
class HomebaseState(val store: Store, private val ctx: Context, private val scope: CoroutineScope) {
    var screen by mutableStateOf<Screen>(Screen.Setup())
    var locked by mutableStateOf(false)
    var servers by mutableStateOf(store.servers)
    var current by mutableStateOf<Server?>(null)
    var apps by mutableStateOf<List<HomeApp>>(emptyList())
    var link by mutableStateOf(Link.Unknown)
    var linkMs by mutableStateOf(0L)
    var linkNote by mutableStateOf("")

    // The Check screen
    var checkResult by mutableStateOf<Net.Check?>(null)
    var checking by mutableStateOf(false)
    var checkToken by mutableStateOf("")

    /** One WebView per app, kept while you switch between apps so each keeps its place. */
    val webViews = mutableMapOf<String, WebView>()

    private var stoppedAt = 0L
    private var firstStart = true
    private var refreshJob: Job? = null

    init {
        val s = store.servers.find { it.url == store.currentUrl } ?: store.servers.firstOrNull()
        if (s != null) {
            current = s
            apps = allApps(s.url)
            screen = Screen.Launcher
        }
    }

    fun app(id: String): HomeApp? = apps.find { it.id == id }
    fun token(): String? = current?.let { store.token(it.url) }
    private fun allApps(url: String) = store.cachedApps(url) + store.manualApps(url)

    // ---------- connecting ----------
    fun startCheck(input: String, token: String? = null) {
        val url = Model.normalizeUrl(input) ?: return
        screen = Screen.Check(url)
        checkToken = token ?: store.token(url) ?: ""
        runCheck(url)
    }

    fun runCheck(url: String) {
        checking = true
        checkResult = null
        scope.launch {
            checkResult = Net.check(url, checkToken.ifBlank { null })
            checking = false
        }
    }

    fun saveServer(url: String, result: Net.Check.Ok) {
        store.setToken(url, checkToken.ifBlank { null })
        val server = Server(url, result.serverName)
        servers = listOf(server) + store.servers.filter { it.url != url }
        store.servers = servers
        store.currentUrl = url
        store.saveApps(url, result.apps)
        current = server
        apps = allApps(url)
        link = Link.Connected
        linkMs = result.ms
        destroyWebViews()
        screen = Screen.Launcher
    }

    /** Re-checks the current server and its app list (on start, on return to the app, on demand). */
    fun refresh() {
        val s = current ?: return
        refreshJob?.cancel()
        link = Link.Checking
        refreshJob = scope.launch {
            when (val r = Net.check(s.url, store.token(s.url))) {
                is Net.Check.Ok -> {
                    store.saveApps(s.url, r.apps)
                    apps = allApps(s.url)
                    link = Link.Connected
                    linkMs = r.ms
                    linkNote = ""
                }
                Net.Check.NeedsToken, Net.Check.BadToken -> link = Link.NeedsToken
                is Net.Check.Unreachable -> {
                    link = if (!Tailscale.vpnOn(ctx)) Link.TailscaleOff else Link.Unreachable
                    linkNote = r.reason
                }
            }
        }
    }

    fun openApp(id: String) {
        val offline = link == Link.TailscaleOff || link == Link.Unreachable
        screen = if (offline && store.warnTailscale) Screen.Offline(id) else Screen.App(id)
    }

    fun switchServer(s: Server) {
        store.currentUrl = s.url
        current = s
        apps = allApps(s.url)
        destroyWebViews()
        screen = Screen.Launcher
        refresh()
    }

    fun addManualApp(name: String, input: String): Boolean {
        val s = current ?: return false
        val url = Model.normalizeUrl(input) ?: return false
        val list = store.manualApps(s.url) + HomeApp("manual-${System.currentTimeMillis()}", name.trim().ifBlank { Model.serverName(url) }, url, 0xFF5B6274, "web", manual = true)
        store.saveManualApps(s.url, list)
        apps = allApps(s.url)
        return true
    }

    fun removeManualApp(id: String) {
        val s = current ?: return
        store.saveManualApps(s.url, store.manualApps(s.url).filter { it.id != id })
        webViews.remove(id)?.destroy()
        apps = allApps(s.url)
    }

    fun changeToken(token: String) {
        val s = current ?: return
        store.setToken(s.url, token)
        destroyWebViews() // pages pick up the new token when they load again
        refresh()
    }

    fun forgetCurrent() {
        val s = current ?: return
        store.forget(s.url)
        servers = store.servers
        destroyWebViews()
        val next = servers.find { it.url == store.currentUrl }
        current = next
        apps = next?.let { allApps(it.url) } ?: emptyList()
        screen = if (next == null) Screen.Setup() else Screen.Launcher
        if (next != null) refresh()
    }

    // ---------- lifecycle and lock ----------
    fun onStart(canLock: Boolean) {
        val away = SystemClock.elapsedRealtime() - stoppedAt
        if (store.lockEnabled && canLock && (firstStart || away > LOCK_AFTER_MS)) locked = true
        if (firstStart) {
            firstStart = false
            if (current != null) {
                val open = store.openOnLaunch
                if (open != "list" && app(open) != null) screen = Screen.App(open)
            }
        }
        if (current != null) refresh()
    }

    fun onStop() { stoppedAt = SystemClock.elapsedRealtime() }

    fun destroyWebViews() {
        webViews.values.forEach { it.destroy() }
        webViews.clear()
    }

    companion object { const val LOCK_AFTER_MS = 5 * 60 * 1000L }
}
