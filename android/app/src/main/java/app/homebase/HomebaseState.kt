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

/**
 * The connection to the current server. With Tailscale off, Homebase looks for the server on your Wi-Fi first
 * ([CheckingWifi]); found there it keeps your apps working through that address ([HomeWifi]); otherwise [TailscaleOff].
 */
enum class Link { Unknown, Checking, Connected, CheckingWifi, HomeWifi, TailscaleOff, Unreachable, NeedsToken }

/** Everything the screens show, in one place. Survives screen changes; not process death (it reloads from [Store]). */
class HomebaseState(val store: Store, val ctx: Context, private val scope: CoroutineScope) {
    var screen by mutableStateOf<Screen>(Screen.Setup())
    var locked by mutableStateOf(false)
    var servers by mutableStateOf(store.servers)
    var current by mutableStateOf<Server?>(null)
    var apps by mutableStateOf<List<HomeApp>>(emptyList())
    /** Reports to the server so an AI assistant can see and use Homebase (see Remote.kt). */
    val remote = Remote(this, scope)

    private var linkState by mutableStateOf(Link.Unknown)
    /** The last few connection states, oldest first (e.g. Checking → CheckingWifi → HomeWifi). */
    val linkTrail = ArrayDeque<Link>()
    var link: Link
        get() = linkState
        set(v) {
            if (v != linkState) {
                linkTrail.addLast(v); while (linkTrail.size > 10) linkTrail.removeFirst()
                remote.event("link", "${linkState.name} → ${v.name}")
            }
            linkState = v
        }
    var linkMs by mutableStateOf(0L)
    var linkNote by mutableStateOf("")

    // The Check screen
    var checkResult by mutableStateOf<Net.Check?>(null)
    var checking by mutableStateOf(false)
    var checkToken by mutableStateOf("")

    /**
     * While Tailscale is off but the server answers on home Wi-Fi: each Tailscale origin and the Wi-Fi origin to use
     * instead (http://alpha5:8080 → http://192.168.1.20:8080). Empty when everything goes the normal way.
     */
    var routes by mutableStateOf<Map<String, String>>(emptyMap())
    /** Bumps when [routes] change, so open apps reload at the right address. */
    var routeVersion by mutableStateOf(0)

    /** The address to use for [app] right now (its Wi-Fi address while on home Wi-Fi without Tailscale). */
    fun urlFor(app: HomeApp): String = urlFor(app.url)
    fun urlFor(url: String): String {
        val o = Model.origin(url) ?: return url
        val local = routes[o] ?: return url
        return local + url.removePrefix(o)
    }

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
        val out = listed.toMutableList()
        val seen = listed.flatMap { aliases(it.url) }.toMutableSet()
        for (m in store.manualApps(url)) {
            // The same app reached another way (Wi-Fi IP vs Tailscale name) is shown once.
            if (aliases(m.url).any { it in seen }) continue
            out += m
            seen += aliases(m.url)
        }
        return out
    }

    /** Checks every app on the launcher at once and marks it running (green) or not responding (red). */
    fun checkApps() {
        // One check at a time; a request during a check runs once more right after it.
        if (statusJob?.isActive == true) { recheck = true; return }
        val list = apps
        if (list.isEmpty()) return
        status = list.associate { it.id to (status[it.id] ?: AppStatus.Checking) }
        val v = routeVersion
        statusJob = scope.launch {
            val results = list.map { a -> async { a.id to if (Probe.alive(urlFor(a))) AppStatus.Up else AppStatus.Down } }.awaitAll()
            // Checked at an address that's no longer in use (Tailscale went off or came back meanwhile): check again.
            when {
                link == Link.CheckingWifi -> {} // still looking on Wi-Fi: it checks again when it knows where to look
                v != routeVersion -> recheck = true
                else -> {
                    val now = results.toMap()
                    for ((id, st) in now) {
                        val was = status[id]
                        if (was != null && was != AppStatus.Checking && was != st) {
                            remote.event("app_status", "${app(id)?.name ?: id}: ${if (st == AppStatus.Up) "running again" else "not responding"}", mapOf("app" to id))
                        }
                    }
                    status = now
                }
            }
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
                lookForNewApps()
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
    fun scanHost(host: String, force: Boolean = false, ports: List<Int> = Probe.PORTS) {
        val h = host.trim().lowercase()
        if (h.isEmpty()) return
        val now = SystemClock.elapsedRealtime()
        if (!force && (scannedAt[h]?.let { now - it < 30_000 } == true)) return
        scannedAt[h] = now
        scanning++
        scope.launch {
            try { Probe.host(h, ports).forEach(::addFound) } finally { scanning-- }
        }
    }

    /** The hosts of the servers you've saved. */
    fun scanKnownHosts(force: Boolean = false) = servers.map { Model.host(it.url) }.distinct().forEach { scanHost(it, force) }

    /** Adds (or merges) a found service: the same install at two addresses is one entry. */
    private fun addFound(f: Found) {
        val keys = f.urls.map(::sameKey).toSet()
        val same = found.filter { it.identity == f.identity || it.urls.any { u -> sameKey(u) in keys } }
        val merged = same.fold(f) { acc, x -> Unify.merge(acc, x) }
        found = (found - same.toSet() + merged).sortedWith(compareBy<Found>({ !it.known }, { it.host }, { it.port }))
        current?.let { apps = allApps(it.url) } // a tile that turned out to be a duplicate goes away
    }

    /** All the addresses known for the service at [url] (itself, plus any other address it was found at). */
    fun aliases(url: String): Set<String> {
        val k = sameKey(url)
        val f = found.firstOrNull { e -> e.urls.any { sameKey(it) == k } } ?: return setOf(k)
        return f.urls.map(::sameKey).toSet()
    }

    /** Services found running that aren't on the launcher yet (and you haven't hidden). */
    val newFound: List<Found>
        get() {
            val s = current ?: return emptyList()
            val have = (apps.map { it.url } + s.url).flatMap { aliases(it) }.toSet()
            val hidden = store.hiddenFound(s.url)
            return found.filter { f -> f.urls.none { sameKey(it) in have } && f.identity !in hidden && sameKey(f.url) !in hidden }
        }
    var hiddenTick by mutableStateOf(0) // bumps so the launcher re-reads [newFound] after hiding

    fun hideFound(list: List<Found>) {
        val s = current ?: return
        store.hideFound(s.url, list.map { it.identity })
        hiddenTick++
    }

    /** On the launcher: look on the server's machine (and the Wi-Fi) for apps you could add. */
    fun lookForNewApps(force: Boolean = false) {
        val s = current ?: return
        startLanDiscovery()
        scanHost(Model.host(s.url), force)
    }

    /** Adds found services to the current server's launcher (skipping any that are already there). */
    fun addFoundApps(list: List<Found>) {
        val s = current ?: return
        val have = (store.cachedApps(s.url) + store.manualApps(s.url)).flatMap { aliases(it.url) }.toSet()
        val add = list.filter { f -> f.urls.none { sameKey(it) in have } }.distinctBy { it.identity }.map { it.toApp() }
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
        store.setJourneys(url, result.isJourneys)
        store.setInstance(url, result.instance)
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
                    applyRoutes(emptyMap())
                    store.setInstance(s.url, r.instance)
                    store.setJourneys(s.url, r.isJourneys)
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
                    linkNote = r.reason
                    if (Tailscale.vpnOn(ctx)) {
                        applyRoutes(emptyMap())
                        link = Link.Unreachable
                        checkApps()
                    } else tryHomeWifi(s)
                }
            }
        }
    }

    /**
     * Tailscale is off and the server's usual address doesn't answer: look for the same server on this Wi-Fi
     * (where it answered last time, addresses it was found at, then the whole /24), and use it there if found.
     */
    private suspend fun tryHomeWifi(s: Server) {
        link = Link.CheckingWifi
        status = apps.associate { it.id to AppStatus.Checking }
        val token = store.token(s.url)
        val origin = Model.origin(s.url) ?: return run { link = Link.TailscaleOff }
        val port = try { java.net.URL(s.url).let { if (it.port > 0) it.port else it.defaultPort } } catch (e: Exception) { 8080 }
        val scheme = if (s.url.startsWith("https")) "https" else "http"
        val instance = store.instance(s.url)
        suspend fun works(o: String) = Net.check(o + s.url.removePrefix(origin), token) is Net.Check.Ok
        // 1. Where it was last time, and any Wi-Fi address it was seen at.
        val known = (listOf(store.lanAddress(s.url)) + aliases(s.url).filter { Unify.reach(it) == 2 }.mapNotNull { Model.origin(it) })
            .filter { it.isNotBlank() && it != origin }.distinct()
        var local = known.firstOrNull { works(it) }
        // 2. Every address on this Wi-Fi.
        if (local == null) {
            val me = LocalScan.wifiAddress(ctx)
            if (me != null) {
                local = LocalScan.find(LocalScan.neighbours(me), port, scheme, instance, "journeys")
                    ?.takeIf { works(it) }
            }
        }
        if (local == null) {
            applyRoutes(emptyMap())
            link = Link.TailscaleOff
            checkApps()
            return
        }
        store.setLanAddress(s.url, local)
        // Apps on the same machine move with it; others use a Wi-Fi address they were found at.
        val lanHost = Model.host(local)
        val serverHost = Model.host(s.url)
        val r = mutableMapOf(origin to local)
        for (a in apps) {
            val o = Model.origin(a.url) ?: continue
            if (o in r) continue
            if (Model.host(a.url) == serverHost) r[o] = o.replaceFirst("://$serverHost", "://$lanHost")
            else aliases(a.url).firstOrNull { Unify.reach(it) == 2 }?.let { Model.origin(it) }?.let { r[o] = it }
        }
        applyRoutes(r)
        link = Link.HomeWifi
        linkNote = lanHost
        checkApps()
    }

    private fun applyRoutes(r: Map<String, String>) {
        if (r == routes) return
        // Apps loaded at the old address reload at the new one.
        val changed = apps.filter { a -> Model.origin(a.url)?.let { routes[it] != r[it] } == true }
        routes = r
        changed.forEach { a -> if (screen != Screen.App(a.id)) webViews.remove(a.id)?.destroy() }
        routeVersion++
    }

    // ---------- noticing network changes (Tailscale on/off, Wi-Fi joined or left) ----------
    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    private val networkChanged = Runnable { if (current != null && screen !is Screen.Setup && screen !is Screen.Check) refresh() }
    private val netCallback = object : android.net.ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: android.net.Network) = soon()
        override fun onLost(network: android.net.Network) = soon()
        override fun onCapabilitiesChanged(network: android.net.Network, caps: android.net.NetworkCapabilities) = soon()
        private fun soon() { main.removeCallbacks(networkChanged); main.postDelayed(networkChanged, 800) }
    }
    private var watching = false
    private fun watchNetwork(on: Boolean) {
        val cm = ctx.getSystemService(android.net.ConnectivityManager::class.java) ?: return
        if (on && !watching) { runCatching { cm.registerDefaultNetworkCallback(netCallback); watching = true } }
        if (!on && watching) { runCatching { cm.unregisterNetworkCallback(netCallback) }; watching = false; main.removeCallbacks(networkChanged) }
    }

    /** Opens an app. Its loading screen shows the steps, and says plainly what's wrong if it can't open. */
    fun openApp(id: String) {
        current?.let { store.countOpen(it.url, id) }
        screen = Screen.App(id)
    }

    /** The app you open most (at least twice), worth loading before you tap it. */
    fun favouriteApp(): HomeApp? {
        val s = current ?: return null
        return apps.maxByOrNull { store.opens(s.url, it.id) }?.takeIf { store.opens(s.url, it.id) >= 2 }
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
        Snapshots.forget(ctx, s.url)
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
        watchNetwork(true)
        remote.start()
    }

    fun onStop() { stoppedAt = SystemClock.elapsedRealtime(); watchNetwork(false); remote.stop() }

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
