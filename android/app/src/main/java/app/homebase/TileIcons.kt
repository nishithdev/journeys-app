package app.homebase

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File
import java.security.MessageDigest

/**
 * Pictures for launcher tiles, kept in memory and in the app's cache folder,
 * so tiles show their icon straight away (also offline) and refresh once a day.
 */
object TileIcons {
    private const val MAX_AGE_MS = 24 * 60 * 60 * 1000L
    private val memory = HashMap<String, Bitmap>()

    private fun file(ctx: Context, url: String): File {
        val hash = MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(File(ctx.cacheDir, "tile-icons").apply { mkdirs() }, hash)
    }

    fun cached(ctx: Context, url: String): Bitmap? = synchronized(memory) { memory[url] }
        ?: file(ctx, url).takeIf { it.exists() }?.let { BitmapFactory.decodeFile(it.path) }?.also { synchronized(memory) { memory[url] = it } }

    /** The icon, fetched again when the cached copy is a day old. Keeps the old one if the server can't be reached. */
    suspend fun load(ctx: Context, url: String): Bitmap? {
        val f = file(ctx, url)
        val have = cached(ctx, url)
        if (have != null && System.currentTimeMillis() - f.lastModified() < MAX_AGE_MS) return have
        val data = Net.bytes(url) ?: return have
        val bmp = BitmapFactory.decodeByteArray(data, 0, data.size) ?: return have
        runCatching { f.writeBytes(data) }
        synchronized(memory) { memory[url] = bmp }
        return bmp
    }
}
