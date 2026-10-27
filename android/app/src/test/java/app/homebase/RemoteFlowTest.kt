package app.homebase

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Homebase reports to a real Journeys server, and an assistant uses the MCP tools to read it and make it act.
 * Needs a Journeys server without APP_TOKEN at HOMEBASE_TEST_DISCOVERY_HOST:8080 (skipped otherwise).
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-xhdpi")
class RemoteFlowTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val host = System.getProperty("homebase.discoveryHost").orEmpty()
    private val base get() = "http://$host:8080"

    /** Calls an MCP tool like an assistant would; returns its text. */
    private var device = ""
    private fun tool(name: String, args: JSONObject = JSONObject()): String {
        if (device.isNotEmpty() && name != "homebase_devices") args.put("device", device)
        val c = URL("$base/mcp").openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.doOutput = true; c.readTimeout = 30_000
        c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("Accept", "application/json, text/event-stream")
        c.outputStream.use { it.write(JSONObject().put("jsonrpc", "2.0").put("id", 1).put("method", "tools/call").put("params", JSONObject().put("name", name).put("arguments", args)).toString().toByteArray()) }
        val body = c.inputStream.bufferedReader().readText()
        return JSONObject(body).getJSONObject("result").getJSONArray("content").getJSONObject(0).getString("text")
    }

    /** Pumps the app's main thread until [done] (the app's network work comes back through it). */
    private fun pumpUntil(ms: Long = 30_000, done: () -> Boolean): Boolean {
        val until = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < until) { ShadowLooper.idleMainLooper(100, java.util.concurrent.TimeUnit.MILLISECONDS); runCatching { compose.waitForIdle() }; if (done()) return true; Thread.sleep(50) }
        return false
    }

    @Test fun assistantSeesAndUsesHomebase() {
        assumeTrue(host.isNotEmpty())
        val state = compose.activity.state
        device = state.store.deviceId
        compose.runOnUiThread {
            state.saveServer(base, Net.Check.Ok("testlab", listOf(HomeApp("journeys", "Journeys", "$base/", 0xFF2451D6, "journeys", injectToken = true)), 3, true, false))
        }
        // 1. It reports: the assistant can see this phone and what's on its launcher.
        var seen = ""
        assertTrue("the phone never showed up", pumpUntil { runCatching { tool("homebase_state") }.getOrNull()?.also { seen = it }?.contains("Server: testlab") == true })
        println(seen)
        assertTrue(seen, seen.contains("in use now") && seen.contains("Journeys (journeys)") && seen.contains("On screen: launcher"))

        // 2. The assistant asks it to open Journeys; the phone does it and answers.
        var answer = ""
        val t = thread { answer = tool("homebase_do", JSONObject().put("action", "open_app").put("app", "journeys")) }
        assertTrue("no answer from the phone", pumpUntil { !t.isAlive })
        assertEquals("Opened Journeys.", answer)
        assertEquals(Screen.App("journeys"), state.screen)

        // 3. …and sees it happen: the screen in the state, the command and the opening in the events.
        assertTrue(pumpUntil { tool("homebase_state").contains("On screen: app: Journeys") })
        var events = ""
        assertTrue(pumpUntil { tool("homebase_events", JSONObject().put("limit", 20)).also { events = it }.contains("app_open: Journeys") })
        println(events)
        assertTrue(events, events.contains("command: open_app journeys: Opened Journeys.") && events.contains("app_open: Journeys"))

        // 4. A refusal comes back as one.
        var refusal = ""
        val t2 = thread { refusal = tool("homebase_do", JSONObject().put("action", "remove_app").put("app", "Journeys")) }
        assertTrue(pumpUntil { !t2.isAlive })
        assertTrue(refusal, refusal.contains("comes from the server's list"))
    }
}
