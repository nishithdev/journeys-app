package app.homebase

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.os.SystemClock
import android.webkit.WebView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest

/** One step of opening an app, shown on the loading screen: Tailscale → server → app → your data. */
enum class StepState { Waiting, Working, Done, Failed, Skipped }

data class OpenStep(val label: String, val state: StepState, val note: String = "")

/** Why an app can't open, said plainly, with what to do about it. */
sealed class Problem(val title: String, val detail: String) {
    data object TailscaleOff : Problem("Tailscale is off", "Turn it on to reach your server. Homebase opens the app as soon as it's back.")
    data class ServerDown(val server: String) :
        Problem("$server isn't answering", "It may be off, restarting, or not on your tailnet right now. Homebase keeps trying.")
    data class AppDown(val app: String, val where: String) :
        Problem("$app isn't running", "$where answers, but $app doesn't. Its container may be stopped or restarting.")
}

object Opening {
    /** A Wi-Fi-only address (192.168.x.x, .local) doesn't need Tailscale; anything else on the tailnet does. */
    fun needsTailscale(url: String): Boolean = Unify.reach(url) != 2

    /** Times one request to the app; null when it doesn't answer. */
    suspend fun reach(url: String, timeoutMs: Int = 4000): Long? {
        val t = SystemClock.elapsedRealtime()
        return if (Probe.alive(url, timeoutMs)) SystemClock.elapsedRealtime() - t else null
    }

    /**
     * Works out what's wrong, quickly (a few seconds, not a browser timeout):
     * Tailscale off, the whole server down, or just this app.
     */
    suspend fun diagnose(ctx: Context, app: HomeApp, server: Server?, checkTailscale: Boolean): Problem? {
        // Try first: a name like "alpha5" may also work on home Wi-Fi without Tailscale.
        if (Probe.alive(app.url, 4000)) return null
        if (checkTailscale && needsTailscale(app.url) && !Tailscale.vpnOn(ctx)) return Problem.TailscaleOff
        val serverName = server?.name ?: Model.serverName(app.url)
        val serverOrigin = server?.url?.let { Model.origin(it) }
        if (serverOrigin != null && serverOrigin != Model.origin(app.url) && Probe.alive(server.url, 4000)) {
            val where = Model.host(app.url).let { h -> if (h == Model.host(server.url)) serverName else h }
            return Problem.AppDown(app.name, where)
        }
        return Problem.ServerDown(serverName)
    }

    /**
     * Asked of the page every few hundred milliseconds while it loads: is it this app's page yet, has the app drawn
     * its first screen (Journeys removes its ".boot" loading screen), and what does its sync pill say.
     */
    fun pageScript(appOrigin: String): String =
        "(function(){try{var here=location.href.indexOf(${org.json.JSONObject.quote(appOrigin)})===0;" +
            "var boot=!!document.querySelector('.boot');var s=document.querySelector('.sync');" +
            "return [here?'here':'away',document.readyState,boot?'boot':'drawn',s?s.textContent:''].join('|')}catch(e){return 'away'}})()"

    data class PageState(val here: Boolean, val loaded: Boolean, val drawn: Boolean, val sync: String) {
        /** Journeys says "Syncing…" while it gets your data; anything else (Synced, Offline…) means it's done. */
        val dataDone: Boolean get() = sync.isNotBlank() && !sync.startsWith("Syncing")
    }

    fun parsePage(raw: String?): PageState {
        val s = raw?.trim()?.removeSurrounding("\"").orEmpty().split('|')
        return PageState(
            here = s.getOrNull(0) == "here",
            loaded = s.getOrNull(1) == "interactive" || s.getOrNull(1) == "complete",
            drawn = s.getOrNull(2) == "drawn",
            sync = s.getOrNull(3).orEmpty().replace("\\u2026", "…"),
        )
    }
}

/**
 * A picture of each app's last screen, shown at once next time it opens (with "Updating…") while the live page loads.
 * Kept in the app's private storage, per server; removed when you forget the server.
 */
object Snapshots {
    private fun dir(ctx: Context) = File(ctx.filesDir, "snapshots").apply { mkdirs() }
    private fun prefix(serverUrl: String): String =
        MessageDigest.getInstance("SHA-1").digest(serverUrl.toByteArray()).take(6).joinToString("") { "%02x".format(it) }

    fun file(ctx: Context, serverUrl: String, appId: String): File =
        File(dir(ctx), "${prefix(serverUrl)}-${appId.replace(Regex("[^A-Za-z0-9_-]"), "_")}.jpg")

    /** Draws the page at half size (plenty for a placeholder, small on disk). Must run on the main thread. */
    fun capture(web: WebView): Bitmap? {
        if (web.width <= 0 || web.height <= 0) return null
        val scale = 0.5f
        val bmp = runCatching { Bitmap.createBitmap((web.width * scale).toInt(), (web.height * scale).toInt(), Bitmap.Config.ARGB_8888) }.getOrNull() ?: return null
        val c = Canvas(bmp)
        c.scale(scale, scale)
        runCatching { web.draw(c) }.onFailure { return null }
        return bmp
    }

    suspend fun save(ctx: Context, serverUrl: String, appId: String, bmp: Bitmap) = withContext(Dispatchers.IO) {
        val f = file(ctx, serverUrl, appId)
        val tmp = File(f.path + ".tmp")
        runCatching {
            tmp.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 80, it) }
            tmp.renameTo(f)
        }
    }

    fun load(ctx: Context, serverUrl: String, appId: String): Pair<Bitmap, Long>? {
        val f = file(ctx, serverUrl, appId)
        if (!f.exists()) return null
        return BitmapFactory.decodeFile(f.path)?.let { it to f.lastModified() }
    }

    fun forget(ctx: Context, serverUrl: String) {
        val p = prefix(serverUrl) + "-"
        dir(ctx).listFiles()?.filter { it.name.startsWith(p) }?.forEach { it.delete() }
    }
}
