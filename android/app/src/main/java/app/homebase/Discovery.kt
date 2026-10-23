package app.homebase

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** A service Homebase found running: on your Wi-Fi (mDNS), or by checking a host's common ports. */
data class Found(
    val url: String,
    val name: String,
    /** "journeys", "life-quest", "home-assistant", or "web" for anything else that answers. */
    val kind: String,
    val subtitle: String = "",
    val iconUrl: String = "",
    val color: Long = 0xFF5B6274,
    val icon: String = "web",
) {
    val host: String get() = Model.host(url)
    val port: Int get() = try { URL(url).let { if (it.port > 0) it.port else it.defaultPort } } catch (e: Exception) { -1 }
    /** Knows about Homebase (or is Home Assistant): worth adding without asking twice. */
    val known: Boolean get() = kind != "web"

    fun toApp(): HomeApp = HomeApp(
        id = "found-${host}-$port", name = name, url = url, color = color, icon = icon,
        subtitle = subtitle, iconUrl = iconUrl, manual = true,
    )
}

/** Looks at one address, or at the usual homelab ports on a host, and says what's running there. */
object Probe {
    /** Ports homelab apps usually use. Journeys 8080, Life Quest 3000, Home Assistant 8123 first. */
    val PORTS = listOf(
        8080, 3000, 8123, 80, 443, 3001, 5000, 8000, 8081, 8096, 2283, 8384, 8443, 8888, 9000, 9090, 19999, 32400,
    )

    private class Page(val code: Int, val body: String)

    /** GET with short timeouts, reading at most [limit] bytes (homepages can be big). */
    private suspend fun fetch(url: String, timeoutMs: Int, limit: Int = 64 * 1024): Page? = withContext(Dispatchers.IO) {
        val c = try { URL(url).openConnection() as HttpURLConnection } catch (e: Exception) { return@withContext null }
        try {
            c.connectTimeout = timeoutMs
            c.readTimeout = timeoutMs
            c.instanceFollowRedirects = true
            val code = c.responseCode
            val stream = (if (code >= 400) c.errorStream else c.inputStream) ?: return@withContext Page(code, "")
            val bytes = stream.use { input ->
                val out = java.io.ByteArrayOutputStream()
                val buf = ByteArray(8192)
                while (out.size() < limit) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                }
                out.toByteArray()
            }
            Page(code, String(bytes, Charsets.UTF_8))
        } catch (e: IOException) { null } finally { c.disconnect() }
    }

    /** Is anything answering at [url]? Any HTTP reply below 500 counts (a login page is still "running"). */
    suspend fun alive(url: String, timeoutMs: Int = 3000): Boolean = withContext(Dispatchers.IO) {
        val c = try { URL(url).openConnection() as HttpURLConnection } catch (e: Exception) { return@withContext false }
        try {
            c.connectTimeout = timeoutMs
            c.readTimeout = timeoutMs
            c.instanceFollowRedirects = false
            c.responseCode in 100..499
        } catch (e: IOException) { false } finally { c.disconnect() }
    }

    fun titleOf(html: String): String? = Regex("<title[^>]*>([^<]{1,80})</title>", RegexOption.IGNORE_CASE).find(html)
        ?.groupValues?.get(1)?.trim()?.replace(Regex("\\s+"), " ")?.takeIf { it.isNotEmpty() }

    /** What runs at [base] (scheme://host:port), or null when nothing answers. */
    suspend fun one(base: String, timeoutMs: Int = 1500): Found? {
        val health = fetch("$base/api/health", timeoutMs, 8 * 1024)
        val info = if (health?.code == 200) runCatching { JSONObject(health.body) }.getOrNull() else null
        when (info?.optString("app")) {
            "journeys" -> return Found(
                "$base/", "Journeys", "journeys", if (info.optBoolean("authRequired")) "Needs your access token" else "",
                color = 0xFF2451D6, icon = "journeys",
            )
            "life-quest" -> {
                val list = fetch("$base/api/homebase", timeoutMs, 16 * 1024)
                val app = if (list?.code == 200) runCatching { Model.parseApps(base, list.body).second.firstOrNull() }.getOrNull() else null
                return Found("$base/", app?.name ?: "Life Quest", "life-quest", app?.subtitle ?: "", app?.iconUrl ?: "", app?.color ?: 0xFF14151F, "quest")
            }
        }
        // Anything else that answers: an app that lists itself for Homebase, or a page with a title.
        val list = fetch("$base/api/homebase", timeoutMs, 16 * 1024)
        if (list?.code == 200) {
            runCatching { Model.parseApps(base, list.body).second.firstOrNull() }.getOrNull()?.let { a ->
                return Found(a.url, a.name, a.id.ifBlank { "homebase" }, a.subtitle, a.iconUrl, a.color, a.icon.ifBlank { "web" })
            }
        }
        val page = fetch("$base/", timeoutMs) ?: return health?.let { Found("$base/", "Web app", "web") }
        if (page.code >= 500 && health == null) return null
        val title = titleOf(page.body)
        if (title != null && title.contains("Home Assistant", ignoreCase = true)) {
            return Found("$base/", "Home Assistant", "home-assistant", color = 0xFF18BCF2, icon = "home")
        }
        return Found("$base/", title ?: "Web app", "web")
    }

    /** Checks [ports] on [host] at once. A port that's closed answers straight away; a silent one waits [timeoutMs]. */
    suspend fun host(host: String, ports: List<Int> = PORTS, timeoutMs: Int = 1500): List<Found> = coroutineScope {
        ports.distinct().map { port ->
            async {
                val scheme = if (port == 443 || port == 8443) "https" else "http"
                val portPart = if ((scheme == "http" && port == 80) || (scheme == "https" && port == 443)) "" else ":$port"
                one("$scheme://$host$portPart", timeoutMs)
            }
        }.awaitAll().filterNotNull()
    }
}

/**
 * Services that announce themselves on your Wi-Fi, the way Home Assistant finds its server:
 * mDNS types `_homebase._tcp` (see homelab/avahi in the repo) and `_home-assistant._tcp`.
 * Only works on the same network as the server; over Tailscale, use [Probe.host].
 */
class LanDiscovery(ctx: Context, private val onFound: (base: String, name: String, kind: String) -> Unit) {
    private val nsd = ctx.getSystemService(NsdManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private val listeners = mutableListOf<NsdManager.DiscoveryListener>()
    private val queue = ArrayDeque<NsdServiceInfo>()
    private var resolving = false

    fun start() {
        if (nsd == null || listeners.isNotEmpty()) return
        for (type in listOf("_homebase._tcp.", "_home-assistant._tcp.")) {
            val l = object : NsdManager.DiscoveryListener {
                override fun onServiceFound(info: NsdServiceInfo) = main.post { queue.addLast(info); next() }.let {}
                override fun onServiceLost(info: NsdServiceInfo) {}
                override fun onDiscoveryStarted(serviceType: String) {}
                override fun onDiscoveryStopped(serviceType: String) {}
                override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {}
                override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
            }
            runCatching { nsd.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, l); listeners += l }
        }
    }

    fun stop() {
        listeners.forEach { runCatching { nsd?.stopServiceDiscovery(it) } }
        listeners.clear()
        queue.clear()
    }

    // NsdManager resolves one service at a time.
    @Suppress("DEPRECATION")
    private fun next() {
        if (resolving || nsd == null) return
        val info = queue.removeFirstOrNull() ?: return
        resolving = true
        nsd.resolveService(info, object : NsdManager.ResolveListener {
            override fun onResolveFailed(i: NsdServiceInfo, errorCode: Int) = main.post { resolving = false; next() }.let {}
            override fun onServiceResolved(i: NsdServiceInfo) = main.post {
                resolving = false
                val addr = i.host?.hostAddress
                if (addr != null && i.port > 0) {
                    val txt = i.attributes.mapValues { (_, v) -> v?.let { String(it, Charsets.UTF_8) } ?: "" }
                    val h = if (addr.contains(':')) "[$addr]" else addr
                    val scheme = if (txt["scheme"] == "https") "https" else "http"
                    val kind = if (i.serviceType.contains("home-assistant")) "home-assistant" else txt["app"].orEmpty().ifBlank { "web" }
                    onFound("$scheme://$h:${i.port}", txt["name"].orEmpty().ifBlank { i.serviceName }, kind)
                }
                next()
            }.let {}
        })
    }
}
