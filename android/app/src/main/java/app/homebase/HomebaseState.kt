package app.homebase

import android.content.Context
import android.os.SystemClock
import android.webkit.WebView
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

sealed interface Screen {
    data class Setup(val prefill: String = "") : Screen
    data class Check(val url: String) : Screen
    data object Launcher : Screen
    data class App(val appId: String) : Screen
    data class Offline(val appId: String?) : Screen
    data object Settings : Screen
}

/** Whether an app on the launcher answers right now. */
enum class AppStatus { Checking, Up, Down }

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

    /** Running or not, per app id, from the last check (on refresh and every 30 s on the launcher). */
    var status by mutableStateOf<Map<String, AppStatus>>(emptyMap())
    private var statusJob: Job? = null

    // Services found running (on your Wi-Fi, or on a host's common ports)
    var found by mutableStateOf<List<Found>>(emptyList())
    var scanning by mutableStateOf(0)
    private val scannedAt = mutableMapOf<String, Long>()
    private var lan: LanDiscovery? = null

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
    /** The server's own list first; an app you added that the server also lists is shown once. */
    private fun allApps(url: String): List<HomeApp> {
        val listed = store.cachedApps(url)
        val keys = listed.map { sameKey(it.url) }.toSet()
        return listed + store.manualApps(url).filter { sameKey(it.url) !in keys }
    }

    /** Checks every app on the launcher at once and marks it running (green) or not responding (red). */
    fun checkApps() {
        // One check at a time; a request during a check runs once more right after it.
        if (statusJob?.isActive == true) { recheck = true; return }
        val list = apps
        if (list.isEmpty()) return
        status = list.associate { it.id to (status[it.id] ?: AppStatus.Checking) }
        statusJob = scope.launch {
            val results = list.map { a -> async { a.id to if (Probe.alive(a.url)) AppStatus.Up else AppStatus.Down } }.awaitAll()
            status = results.toMap()
            if (recheck) { recheck = false; statusJob = null; checkApps() }
        }
    }
    private var recheck = false

    /** Re-checks the running dots every 30 seconds while the launcher is showing. */
    private var statusLoop: Job? = null
    fun startStatusLoop() {
        if (statusLoop?.isActive == true) return
        statusLoop = scope.launch {
            while (true) {
                delay(30_000)
                checkApps()
            }
        }
    }
    fun stopStatusLoop() { statusLoop?.cancel(); statusLoop = null }

    // ---------- finding services ----------
    /** Starts listening for services that announce themselves on this Wi-Fi (mDNS). */
    fun startLanDiscovery() {
        if (lan != null) return
        lan = LanDiscovery(ctx) { base, name, kind ->
            scope.launch {
                addFound(Probe.one(base) ?: Found("$base/", name, kind))
                scanHost(Model.host(base)) // and whatever else runs on that machine
            }
        }.also { it.start() }
    }

    fun stopLanDiscovery() { lan?.stop(); lan = null }

    /** Checks the usual ports on [host]. Skipped if it was checked in the last 30 seconds, unless [force]. */
    fun scanHost(host: String, force: Boolean = false) {
        val h = host.trim().lowercase()
        if (h.isEmpty()) return
        val now = SystemClock.elapsedRealtime()
        if (!force && (scannedAt[h]?.let { now - it < 30_000 } == true)) return
        scannedAt[h] = now
        scanning++
        scope.launch {
            try { Probe.host(h).forEach(::addFound) } finally { scanning-- }
        }
    }

    /** The hosts of the servers you've saved. */
    fun scanKnownHosts(force: Boolean = false) = servers.map { Model.host(it.url) }.distinct().forEach { scanHost(it, force) }

    private fun addFound(f: Found) {
        found = (found.filter { sameKey(it.url) != sameKey(f.url) } + f)
            .sortedWith(compareBy<Found>({ !it.known }, { it.host }, { it.port }))
    }

    /** Adds found services to the current server's launcher (skipping any that are already there). */
    fun addFoundApps(list: List<Found>) {
        val s = current ?: return
        val have = (store.cachedApps(s.url) + store.manualApps(s.url)).map { sameKey(it.url) }.toSet()
        val add = list.filter { sameKey(it.url) !in have }.map { it.toApp() }
        if (add.isEmpty()) return
        store.saveManualApps(s.url, store.manualApps(s.url) + add)
        apps = allApps(s.url)
        checkApps()
    }

    /** Apps added from discovery keep their tile up to date (Life Quest's level, badge, icon). */
    private suspend fun refreshFoundApps(serverUrl: String) {
        val manual = store.manualApps(serverUrl)
        if (manual.none { it.id.startsWith("found-") }) return
        val updated = manual.map { a ->
            if (!a.id.startsWith("found-")) return@map a
            val base = Model.origin(a.url) ?: return@map a
            val f = Probe.one(base) ?: return@map a
            if (!f.known) a else a.copy(subtitle = f.subtitle.ifBlank { a.subtitle }, iconUrl = f.iconUrl.ifBlank { a.iconUrl }, color = f.color)
        }
        if (updated != manual) {
            store.saveManualApps(serverUrl, updated)
            if (current?.url == serverUrl) apps = allApps(serverUrl)
        }
    }

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
        checkApps()
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
                    refreshFoundApps(s.url)
                    checkApps()
                }
                Net.Check.NeedsToken, Net.Check.BadToken -> link = Link.NeedsToken
                is Net.Check.Unreachable -> {
                    link = if (!Tailscale.vpnOn(ctx)) Link.TailscaleOff else Link.Unreachable
                    linkNote = r.reason
                    checkApps()
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
        checkApps()
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

    companion object {
        const val LOCK_AFTER_MS = 5 * 60 * 1000L
        /** Same address, ignoring a trailing slash and http's default port. */
        fun sameKey(url: String): String = (Model.normalizeUrl(url) ?: url).replace(Regex("^http://([^/:]+):80(?=/|$)"), "http://$1")
    }
}
