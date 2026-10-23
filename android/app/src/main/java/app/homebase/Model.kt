package app.homebase

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

/** A homelab server Homebase knows about. [url] is its base address, e.g. http://alpha5.tailnet.ts.net:8080 */
data class Server(val url: String, val name: String)

/** One app on the launcher: something the server lists, or an address you added by hand. */
data class HomeApp(
    val id: String,
    val name: String,
    val url: String,
    val color: Long = 0xFF3F5EFB,
    val icon: String = "",
    val subtitle: String = "",
    val badge: Int = 0,
    /** Hand the stored access token to this app's page (Journeys reads it from its own settings). */
    val injectToken: Boolean = false,
    val manual: Boolean = false,
)

/** Pure helpers, no Android classes, so they're unit-tested on the JVM. */
object Model {
    /** Turns what someone types into a base address: adds http://, drops a trailing slash and any #fragment or ?query. */
    fun normalizeUrl(input: String): String? {
        var s = input.trim()
        if (s.isEmpty()) return null
        if (!s.contains("://")) s = "http://$s"
        val u = try { URI(s) } catch (e: Exception) { return null }
        val scheme = u.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") return null
        val host = u.host ?: return null
        if (host.isEmpty()) return null
        val port = if (u.port > 0) ":${u.port}" else ""
        val path = (u.rawPath ?: "").trimEnd('/')
        return "$scheme://${host.lowercase()}$port$path"
    }

    /** scheme://host[:port] — what a WebView means by an origin. */
    fun origin(url: String): String? = try {
        val u = URI(url)
        if (u.scheme == null || u.host == null) null
        else "${u.scheme.lowercase()}://${u.host.lowercase()}${if (u.port > 0) ":${u.port}" else ""}"
    } catch (e: Exception) { null }

    fun host(url: String): String = try { URI(url).host ?: url } catch (e: Exception) { url }

    /** "alpha5" from http://alpha5.tailnet.ts.net:8080; an IP stays whole. */
    fun serverName(url: String): String {
        val h = host(url)
        return if (h.matches(Regex("""\d+\.\d+\.\d+\.\d+"""))) h else h.substringBefore('.')
    }

    fun resolve(base: String, ref: String): String = try { URI("$base/").resolve(ref).toString() } catch (e: Exception) { ref }

    fun parseColor(s: String?, def: Long): Long {
        val h = s?.trim()?.removePrefix("#") ?: return def
        return if (h.length == 6 && h.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }) 0xFF000000L or h.toLong(16) else def
    }

    /**
     * Reads the server's app list (GET /api/homebase on a Journeys server):
     * { "server": { "name": "alpha5" }, "apps": [ { "id", "name", "url" or "path", "color", "icon", "subtitle", "badge", "token" } ] }
     * Returns the server's name (if given) and the apps; entries without a name or address are skipped.
     */
    fun parseApps(base: String, json: String): Pair<String?, List<HomeApp>> {
        val o = JSONObject(json)
        val name = o.optJSONObject("server")?.optString("name")?.takeIf { it.isNotBlank() }
        val arr = o.optJSONArray("apps") ?: JSONArray()
        val apps = mutableListOf<HomeApp>()
        for (i in 0 until arr.length()) {
            val a = arr.optJSONObject(i) ?: continue
            val appName = a.optString("name").trim()
            val raw = a.optString("url").ifBlank { a.optString("path") }.trim()
            if (appName.isEmpty() || raw.isEmpty()) continue
            val url = if (raw.contains("://")) raw else resolve(base, raw.removePrefix("/"))
            if (normalizeUrl(url) == null) continue
            apps += HomeApp(
                id = a.optString("id").ifBlank { "app$i" },
                name = appName,
                url = url,
                color = parseColor(a.optString("color"), 0xFF3F5EFB),
                icon = a.optString("icon"),
                subtitle = a.optString("subtitle"),
                badge = a.optInt("badge", 0).coerceAtLeast(0),
                injectToken = a.optBoolean("token", false),
            )
        }
        return name to apps
    }

    // ---- storage as JSON ----
    fun appsToJson(list: List<HomeApp>): String = JSONArray().apply {
        list.forEach {
            put(JSONObject().put("id", it.id).put("name", it.name).put("url", it.url).put("color", it.color)
                .put("icon", it.icon).put("subtitle", it.subtitle).put("badge", it.badge)
                .put("token", it.injectToken).put("manual", it.manual))
        }
    }.toString()

    fun appsFromJson(s: String?): List<HomeApp> {
        if (s.isNullOrBlank()) return emptyList()
        return try {
            val a = JSONArray(s)
            (0 until a.length()).mapNotNull { i ->
                val o = a.optJSONObject(i) ?: return@mapNotNull null
                HomeApp(o.optString("id"), o.optString("name"), o.optString("url"), o.optLong("color", 0xFF3F5EFB),
                    o.optString("icon"), o.optString("subtitle"), o.optInt("badge"), o.optBoolean("token"), o.optBoolean("manual"))
            }
        } catch (e: Exception) { emptyList() }
    }

    fun serversToJson(list: List<Server>): String = JSONArray().apply {
        list.forEach { put(JSONObject().put("url", it.url).put("name", it.name)) }
    }.toString()

    fun serversFromJson(s: String?): List<Server> {
        if (s.isNullOrBlank()) return emptyList()
        return try {
            val a = JSONArray(s)
            (0 until a.length()).mapNotNull { i -> a.optJSONObject(i)?.let { Server(it.optString("url"), it.optString("name")) } }
                .filter { it.url.isNotBlank() }
        } catch (e: Exception) { emptyList() }
    }

    /** JavaScript run before a page's own scripts: puts the token where the Journeys app reads it. */
    fun tokenScript(token: String): String {
        val t = JSONObject.quote(token)
        return "(function(){try{var k='jt.config',c=JSON.parse(localStorage.getItem(k)||'{}')||{};" +
            "if(c.token!==$t){c.token=$t;localStorage.setItem(k,JSON.stringify(c));}}catch(e){}})();"
    }
}
