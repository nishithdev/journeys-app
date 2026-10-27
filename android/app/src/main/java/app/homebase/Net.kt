package app.homebase

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.SystemClock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Talking to the server. Plain HttpURLConnection: no extra libraries. */
object Net {
    class Response(val code: Int, val body: String, val ms: Long)

    @Throws(IOException::class)
    suspend fun get(url: String, token: String? = null, timeoutMs: Int = 6000): Response = withContext(Dispatchers.IO) {
        val start = SystemClock.elapsedRealtime()
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = timeoutMs
            c.readTimeout = timeoutMs
            c.instanceFollowRedirects = true
            c.setRequestProperty("Accept", "application/json")
            if (!token.isNullOrBlank()) c.setRequestProperty("Authorization", "Bearer $token")
            val code = c.responseCode
            val stream = if (code >= 400) c.errorStream else c.inputStream
            val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
            Response(code, body, SystemClock.elapsedRealtime() - start)
        } finally {
            c.disconnect()
        }
    }

    /** POSTs JSON. */
    @Throws(IOException::class)
    suspend fun post(url: String, json: String, token: String? = null, timeoutMs: Int = 8000): Response = withContext(Dispatchers.IO) {
        val start = SystemClock.elapsedRealtime()
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = timeoutMs
            c.readTimeout = timeoutMs
            c.requestMethod = "POST"
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.setRequestProperty("Accept", "application/json")
            if (!token.isNullOrBlank()) c.setRequestProperty("Authorization", "Bearer $token")
            c.outputStream.use { it.write(json.toByteArray()) }
            val code = c.responseCode
            val stream = if (code >= 400) c.errorStream else c.inputStream
            val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
            Response(code, body, SystemClock.elapsedRealtime() - start)
        } finally {
            c.disconnect()
        }
    }

    sealed interface Check {
        data class Ok(
            val serverName: String, val apps: List<HomeApp>, val ms: Long, val isJourneys: Boolean, val https: Boolean,
            /** The server's install ID, if it reports one: lets Homebase find the same server on Wi-Fi. */
            val instance: String = "",
        ) : Check
        data object NeedsToken : Check
        data object BadToken : Check
        data class Unreachable(val reason: String) : Check
    }

    /**
     * Reaches the server and finds its apps. Any server can list apps at /api/homebase (Journeys and Life Quest do);
     * a server that doesn't becomes a single app.
     */
    suspend fun check(base: String, token: String?): Check {
        val health = try { get("$base/api/health", timeoutMs = 5000) } catch (e: IOException) {
            return Check.Unreachable(e.message ?: e.javaClass.simpleName)
        }
        val https = base.startsWith("https://")
        val info = if (health.code == 200) runCatching { JSONObject(health.body) }.getOrNull() else null
        val isJourneys = info?.optString("app") == "journeys"
        if (info?.optBoolean("authRequired") == true && token.isNullOrBlank()) return Check.NeedsToken

        val list = try { get("$base/api/homebase", token) } catch (e: IOException) {
            return Check.Unreachable(e.message ?: "No answer")
        }
        when (list.code) {
            200 -> {
                val parsed = runCatching { Model.parseApps(base, list.body) }.getOrNull()
                if (parsed != null && parsed.second.isNotEmpty()) {
                    return Check.Ok(parsed.first ?: Model.serverName(base), parsed.second, health.ms, isJourneys, https, info?.optString("instance").orEmpty())
                }
                if (isJourneys) return Check.Unreachable("The server's app list couldn't be read")
            }
            // Only a server that says it can use a token is asked for one (Grafana and friends answer 401 to unknown paths).
            401 -> if (isJourneys || info?.has("authRequired") == true) return if (token.isNullOrBlank()) Check.NeedsToken else Check.BadToken
        }
        // An older Journeys server without the app list: just Journeys.
        if (isJourneys) {
            return if (list.code == 404) Check.Ok(Model.serverName(base), listOf(HomeApp("journeys", "Journeys", base, 0xFF2451D6, "journeys", injectToken = true)), health.ms, true, https, info.optString("instance"))
            else Check.Unreachable("The server answered HTTP ${list.code}")
        }
        // Any other web server: whatever answers is one app.
        val page = try { get(base, timeoutMs = 5000) } catch (e: IOException) { return Check.Unreachable(e.message ?: "No answer") }
        if (page.code >= 500) return Check.Unreachable("The server answered HTTP ${page.code}")
        val name = Model.serverName(base)
        return Check.Ok(name, listOf(HomeApp(id = "web", name = name, url = base, icon = "web")), page.ms, false, https)
    }

    /** Fetches a picture (a tile icon). Null when it isn't there or isn't an image. */
    suspend fun bytes(url: String, timeoutMs: Int = 6000, maxBytes: Int = 512 * 1024): ByteArray? = withContext(Dispatchers.IO) {
        val c = try { URL(url).openConnection() as HttpURLConnection } catch (e: Exception) { return@withContext null }
        try {
            c.connectTimeout = timeoutMs
            c.readTimeout = timeoutMs
            if (c.responseCode != 200) return@withContext null
            val out = java.io.ByteArrayOutputStream()
            c.inputStream.use { input ->
                val buf = ByteArray(8192)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    if (out.size() > maxBytes) return@withContext null
                }
            }
            out.toByteArray()
        } catch (e: IOException) { null } finally { c.disconnect() }
    }
}

/** The Tailscale app does the networking; Homebase only checks on it and opens it. */
object Tailscale {
    const val PACKAGE = "com.tailscale.ipn"

    fun installed(ctx: Context): Boolean = ctx.packageManager.getLaunchIntentForPackage(PACKAGE) != null

    /** True when a VPN (Tailscale, normally) is up. */
    fun vpnOn(ctx: Context): Boolean {
        val cm = ctx.getSystemService(ConnectivityManager::class.java) ?: return false
        val net = cm.activeNetwork ?: return false
        return cm.getNetworkCapabilities(net)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
    }

    fun open(ctx: Context) {
        val intent = ctx.packageManager.getLaunchIntentForPackage(PACKAGE)
            ?: Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$PACKAGE"))
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
    }
}
