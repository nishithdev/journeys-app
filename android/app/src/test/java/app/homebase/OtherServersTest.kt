package app.homebase

import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.net.InetAddress
import java.net.ServerSocket
import kotlin.concurrent.thread

/** Servers other than Journeys: one that lists its apps (Life Quest), and plain web apps. */
@RunWith(RobolectricTestRunner::class)
class OtherServersTest {
    /** A tiny HTTP server on a real socket: path -> (status, body). Raw bytes for the icon. */
    private lateinit var socket: ServerSocket
    private val routes = mutableMapOf<String, Pair<Int, String>>()
    private val raw = mutableMapOf<String, ByteArray>()
    private val base get() = "http://127.0.0.1:${socket.localPort}"

    @Before fun start() {
        socket = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        thread(isDaemon = true) {
            while (!socket.isClosed) {
                val c = try { socket.accept() } catch (e: Exception) { break }
                c.use {
                    val reader = c.getInputStream().bufferedReader()
                    val path = reader.readLine()?.split(" ")?.getOrNull(1)?.substringBefore('?') ?: "/"
                    while (reader.readLine()?.isNotEmpty() == true) { /* headers */ }
                    val bytes = raw[path] ?: (routes[path]?.second ?: "{\"error\":\"not found\"}").toByteArray()
                    val code = if (raw.containsKey(path)) 200 else routes[path]?.first ?: 404
                    val out = c.getOutputStream()
                    out.write("HTTP/1.1 $code X\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                    out.write(bytes)
                    out.flush()
                }
            }
        }
    }

    @After fun stop() = socket.close()

    @Test fun lifeQuestListsItselfWithAPixelIcon() = runBlocking {
        // What Life Quest answers (copied from a real run).
        routes["/api/health"] = 200 to """{"ok":true,"app":"life-quest","version":"0.1.0","authRequired":false}"""
        routes["/api/homebase"] = 200 to """{"apps":[{"id":"life-quest","name":"Life Quest","path":"/","color":"#14151f","icon":"quest","iconUrl":"/api/homebase/icon.png","subtitle":"LV 29 in 2 days · 13 steps ready · Sunday review","badge":1}]}"""
        val r = Net.check(base, null)
        assertTrue(r.toString(), r is Net.Check.Ok)
        r as Net.Check.Ok
        assertFalse(r.isJourneys)
        val app = r.apps.single()
        assertEquals("Life Quest", app.name)
        assertEquals("$base/", app.url)
        assertEquals("$base/api/homebase/icon.png", app.iconUrl)
        assertEquals(1, app.badge)
        assertEquals(0xFF14151F, app.color)
        assertFalse(app.injectToken)
    }

    @Test fun aPlainWebAppIsOneTile() = runBlocking {
        routes["/"] = 200 to "<html>hello</html>"
        val r = Net.check(base, null) as Net.Check.Ok
        assertEquals("web", r.apps.single().id)
    }

    @Test fun anAppThatAnswers401ToUnknownPathsIsNotAskedForAToken() = runBlocking {
        // Grafana-style: JSON health without authRequired, 401 for anything under /api.
        routes["/api/health"] = 200 to """{"database":"ok"}"""
        routes["/api/homebase"] = 401 to """{"message":"Unauthorized"}"""
        routes["/"] = 200 to "<html>grafana</html>"
        val r = Net.check(base, null)
        assertTrue(r.toString(), r is Net.Check.Ok)
    }

    @Test fun iconsAreFetchedAndCached() = runBlocking {
        val png = java.util.Base64.getDecoder().decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
        raw["/icon.png"] = png
        val ctx = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        assertNotNull(TileIcons.load(ctx, "$base/icon.png"))
        socket.close()
        assertNotNull("kept after the server goes away", TileIcons.cached(ctx, "$base/icon.png"))
    }
}
