package app.homebase

import android.os.Build
import android.os.SystemClock
import android.webkit.WebView
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.coroutines.resume

/**
 * Lets an AI assistant see and use Homebase, through the Journeys server's MCP tools (server/homebase-remote.js).
 * While Homebase is open it reports its live state there (on every change, and every 30 s), sends what happened
 * (events), and waits for things to do (commands), answering each one.
 *
 * Only to a Journeys server, with the same access token as the app. Nothing private leaves the phone: no token,
 * no page contents or pictures — names, addresses, statuses, timings and settings.
 */
class Remote(private val state: HomebaseState, private val scope: CoroutineScope) {
    private class Event(val seq: Long, val at: String, val type: String, val text: String, val data: Map<String, Any?>)

    private val events = ArrayDeque<Event>()
    private var seq = 0L
    private var sentSeq = 0L
    private var jobs = listOf<Job>()
    private var lastSent = ""
    private var lastSentAt = 0L
    @Volatile private var dirty = true
    private val clock = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)

    /** Something worth knowing happened (kept until it reaches the server; the last 200). */
    fun event(type: String, text: String, data: Map<String, Any?> = emptyMap()) {
        events.addLast(Event(++seq, clock.format(Date()), type, text, data))
        while (events.size > 200) events.removeFirst()
        dirty = true
    }

    /** What Settings shows under "Claude access": when the last report got through, or why it didn't. */
    data class Status(val lastOkAt: Long = 0, val problem: String = "", val server: String = "")
    var status by androidx.compose.runtime.mutableStateOf(Status())
        private set

    /** Servers that answered 404 (not a Journeys server, or an older one), and until when to leave them alone. */
    private val unsupported = mutableMapOf<String, Long>()

    private fun base(): Pair<String, String?>? {
        val s = state.current ?: run { status = status.copy(problem = "No server yet"); return null }
        if ((unsupported[s.url] ?: 0) > SystemClock.elapsedRealtime()) return null
        return state.urlFor(s.url).trimEnd('/') to state.store.token(s.url)
    }

    /** Settings' "Send now". */
    fun sendNow() { dirty = true; scope.launch { runCatching { send(foreground = true) } } }

    fun start() {
        if (jobs.any { it.isActive }) return
        event("start", "Homebase opened")
        jobs = listOf(scope.launch { reportLoop() }, scope.launch { commandLoop() })
    }

    fun stop() {
        jobs.forEach { it.cancel() }
        jobs = emptyList()
        event("stop", "Homebase went to the background")
        scope.launch { runCatching { send(foreground = false) } } // last word: "in the background"
    }

    // ---------- reporting ----------
    private suspend fun reportLoop() {
        while (scope.isActive) {
            val now = SystemClock.elapsedRealtime()
            val fp = fingerprint()
            if (dirty || fp != lastSent || now - lastSentAt > 30_000) {
                val ok = runCatching { send(foreground = true) }.getOrElse { e ->
                    status = status.copy(problem = "Can't reach ${state.current?.name ?: "the server"}: ${e.message ?: e.javaClass.simpleName}")
                    false
                }
                if (ok) { lastSent = fp; lastSentAt = now }
                else delay(4_000) // server not reachable now: try again a little later
            }
            delay(1_000)
        }
    }

    /** A cheap summary of what's on screen; when it changes, a report goes out. */
    private fun fingerprint(): String = listOf(
        state.link, state.linkNote, state.screen, state.current?.url, state.routes,
        state.apps.map { it.id + it.subtitle + it.badge }, state.status, state.newFound.map { it.url },
    ).joinToString("|")

    private suspend fun send(foreground: Boolean): Boolean {
        val (b, token) = base() ?: return false
        val pending = events.filter { it.seq > sentSeq }
        dirty = false
        val body = JSONObject()
            .put("device", JSONObject().put("id", state.store.deviceId).put("name", deviceName()).put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
                .put("android", Build.VERSION.RELEASE).put("app_version", BuildConfig.VERSION_NAME))
            .put("foreground", foreground)
            .put("state", snapshot())
            .put("events", JSONArray().apply {
                pending.forEach { e ->
                    put(JSONObject().put("seq", e.seq).put("at", e.at).put("type", e.type).put("text", e.text)
                        .put("data", JSONObject(e.data.filterValues { it != null })))
                }
            })
        val name = state.current?.name ?: ""
        val r = Net.post("$b/api/homebase/report", body.toString(), token)
        if (r.code == 404) {
            // Not a Journeys server, or one from before this feature: leave it alone for 10 minutes.
            state.current?.url?.let { unsupported[it] = SystemClock.elapsedRealtime() + 10 * 60_000 }
            status = Status(status.lastOkAt, "$name doesn't take reports. It needs to be a Journeys server, updated (rebuilt) after October 27.", name)
            return false
        }
        if (r.code == 401) { status = Status(status.lastOkAt, "$name didn't accept the access token. Check it in Settings.", name); dirty = true; return false }
        if (r.code != 200) { status = Status(status.lastOkAt, "$name answered HTTP ${r.code}.", name); dirty = true; return false }
        state.current?.url?.let { state.store.setJourneys(it, true) }
        status = Status(System.currentTimeMillis(), "", name)
        val last = runCatching { JSONObject(r.body).optLong("last_seq", 0) }.getOrDefault(0L)
        sentSeq = maxOf(sentSeq, if (last > 0) last else pending.lastOrNull()?.seq ?: sentSeq)
        return true
    }

    private fun deviceName(): String = runCatching {
        android.provider.Settings.Global.getString(state.ctx.contentResolver, "device_name")
    }.getOrNull()?.takeIf { it.isNotBlank() } ?: Build.MODEL

    private fun snapshot(): JSONObject {
        val s = state.current
        val screen = when (val sc = state.screen) {
            is Screen.App -> "app: ${state.app(sc.appId)?.name ?: sc.appId}"
            Screen.Launcher -> "launcher"
            Screen.Settings -> "settings"
            is Screen.Setup -> "connect screen"
            is Screen.Check -> "checking a new server"
            is Screen.Offline -> "offline screen"
        }
        return JSONObject()
            .put("at", clock.format(Date()))
            .put("screen", screen)
            .put("open_app", (state.screen as? Screen.App)?.appId ?: "")
            .put("server", s?.let { JSONObject().put("name", it.name).put("url", it.url) })
            .put("link", state.link.name).put("link_note", state.linkNote).put("link_ms", state.linkMs)
            .put("tailscale_on", Tailscale.vpnOn(state.ctx))
            .put("wifi_ip", LocalScan.wifiAddress(state.ctx)?.hostAddress ?: "")
            .put("routes", JSONObject(state.routes as Map<*, *>))
            .put("apps", JSONArray().apply {
                state.apps.forEach { a ->
                    put(JSONObject().put("id", a.id).put("name", a.name).put("url", a.url).put("effective_url", state.urlFor(a))
                        .put("status", (state.status[a.id] ?: AppStatus.Checking).name).put("subtitle", a.subtitle).put("badge", a.badge).put("manual", a.manual))
                }
            })
            .put("new_apps", JSONArray().apply {
                state.newFound.forEach { f -> put(JSONObject().put("name", f.name).put("url", f.url).put("kind", f.kind).put("also", JSONArray(f.alts))) }
            })
            .put("servers", JSONArray().apply { state.servers.forEach { put(JSONObject().put("name", it.name).put("url", it.url)) } })
            .put("settings", JSONObject().put("open_on_launch", state.store.openOnLaunch).put("lock_enabled", state.store.lockEnabled)
                .put("tailscale_warning", state.store.warnTailscale))
    }

    // ---------- commands ----------
    private suspend fun commandLoop() {
        while (scope.isActive) {
            val bt = base()
            if (bt == null) { delay(5_000); continue }
            val (b, token) = bt
            val r = runCatching { Net.get("$b/api/homebase/commands?device=${state.store.deviceId}&wait=25", token, timeoutMs = 35_000) }.getOrNull()
            if (r == null || r.code != 200) { delay(5_000); continue }
            val list = runCatching { JSONObject(r.body).optJSONArray("commands") }.getOrNull() ?: continue
            for (i in 0 until list.length()) {
                val c = list.optJSONObject(i) ?: continue
                val id = c.optString("id")
                val action = c.optString("action")
                val args = c.optJSONObject("args") ?: JSONObject()
                val (ok, result) = runCatching { run(action, args) }.getOrElse { false to (it.message ?: it.javaClass.simpleName) }
                event("command", "$action${args.optString("app").takeIf { it.isNotBlank() }?.let { " $it" } ?: ""}: $result", mapOf("ok" to ok))
                runCatching {
                    Net.post("$b/api/homebase/commands/ack", JSONObject().put("device", state.store.deviceId).put("id", id).put("ok", ok).put("result", result).toString(), token)
                }
            }
        }
    }

    private fun findApp(ref: String): HomeApp? {
        val r = ref.trim().lowercase()
        return state.apps.firstOrNull { it.id.lowercase() == r } ?: state.apps.firstOrNull { it.name.lowercase() == r }
            ?: state.apps.filter { it.name.lowercase().contains(r) }.singleOrNull()
    }

    private fun findFound(ref: String): Found? {
        val r = ref.trim().lowercase()
        return state.newFound.firstOrNull { f -> f.name.lowercase() == r || f.urls.any { HomebaseState.sameKey(it) == HomebaseState.sameKey(ref) } }
            ?: state.newFound.filter { it.name.lowercase().contains(r) }.singleOrNull()
    }

    /** Runs one command on the main thread and says how it went. Never touches the token, the lock or saved servers. */
    private suspend fun run(action: String, a: JSONObject): Pair<Boolean, String> {
        val appRef = a.optString("app")
        return when (action) {
            "refresh" -> { state.refresh(); true to "Checking the connection to ${state.current?.name}." }
            "check_apps" -> { state.checkApps(); true to "Checking ${state.apps.size} apps." }
            "look_for_new_apps" -> { state.lookForNewApps(force = true); true to "Looking for new apps on ${state.current?.let { Model.host(it.url) }} and the Wi-Fi." }
            "open_app" -> findApp(appRef)?.let { state.openApp(it.id); true to "Opened ${it.name}." } ?: (false to "No app matches \"$appRef\".")
            "show_launcher" -> { state.screen = Screen.Launcher; true to "Showing the launcher." }
            "reload_app" -> findApp(appRef)?.let { app ->
                val w = state.webViews[app.id] ?: return false to "${app.name} isn't loaded right now. Open it first."
                w.reload(); true to "Reloading ${app.name}."
            } ?: (false to "No app matches \"$appRef\".")
            "page_info" -> findApp(appRef)?.let { app ->
                val w = state.webViews[app.id] ?: return false to "${app.name} isn't loaded right now. Open it first."
                true to "${app.name}: ${pageInfo(w)}"
            } ?: (false to "No app matches \"$appRef\".")
            "add_found_app" -> findFound(appRef)?.let { f -> state.addFoundApps(listOf(f)); true to "Added ${f.name} (${f.url})." }
                ?: (false to "No found app matches \"$appRef\". Found: ${state.newFound.joinToString { it.name }.ifBlank { "none" }}.")
            "hide_found_app" -> findFound(appRef)?.let { f -> state.hideFound(listOf(f)); true to "Hid ${f.name}." } ?: (false to "No found app matches \"$appRef\".")
            "add_app" -> {
                val url = a.optString("url")
                if (state.addManualApp(a.optString("name"), url)) true to "Added ${a.optString("name").ifBlank { url }}." else false to "That doesn't look like an address: $url"
            }
            "remove_app" -> findApp(appRef)?.let { app ->
                if (!app.manual) return false to "${app.name} comes from the server's list; it can only be removed there."
                state.removeManualApp(app.id); true to "Removed ${app.name}."
            } ?: (false to "No app matches \"$appRef\".")
            "set_open_on_launch" -> {
                val v = a.optString("value").trim()
                if (v.equals("launcher", true) || v.equals("list", true)) { state.store.openOnLaunch = "list"; true to "Homebase will open the launcher on start." }
                else findApp(v)?.let { state.store.openOnLaunch = it.id; true to "Homebase will open ${it.name} on start." } ?: (false to "No app matches \"$v\".")
            }
            "set_tailscale_warning" -> {
                val on = a.optString("value").trim().lowercase() in setOf("on", "true", "yes", "1")
                state.store.warnTailscale = on; true to "Tailscale check turned ${if (on) "on" else "off"}."
            }
            else -> false to "Homebase doesn't know \"$action\"."
        }
    }

    private suspend fun pageInfo(w: WebView): String = suspendCancellableCoroutine { c ->
        w.evaluateJavascript(
            "(function(){var s=document.querySelector('.sync');return JSON.stringify({title:document.title,address:location.href," +
                "state:document.readyState,sync:s?s.textContent:null,loading:!!document.querySelector('.boot')})})()",
        ) { raw ->
            val txt = runCatching { JSONObject(JSONObject("{\"v\":$raw}").getString("v")) }.getOrNull()
            c.resume(
                if (txt == null) "the page didn't answer" else
                    "\"${txt.optString("title")}\" at ${txt.optString("address")}" +
                        (if (txt.optBoolean("loading")) " · still loading" else "") +
                        (txt.optString("sync").takeIf { it.isNotBlank() && it != "null" }?.let { " · sync: $it" } ?: ""),
            )
        }
    }
}
