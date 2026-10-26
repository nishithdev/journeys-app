package app.homebase

import android.graphics.Bitmap
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowLooper
import java.io.File
import java.net.ServerSocket

/** What the launcher says while Tailscale is off: looking on Wi-Fi, then using home Wi-Fi or offline. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h891dp-xhdpi")
class LauncherStatesTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val out = File("build/screens").apply { mkdirs() }

    private fun shot(name: String) {
        repeat(10) { Thread.sleep(50); ShadowLooper.idleMainLooper(); compose.waitForIdle() }
        compose.activityRule.scenario.onActivity { a ->
            val v = a.window.decorView
            val bmp = Bitmap.createBitmap(v.width, v.height, Bitmap.Config.ARGB_8888)
            v.draw(android.graphics.Canvas(bmp))
            File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
    }
    private fun waitFor(text: String) = compose.waitUntil(20_000) {
        ShadowLooper.idleMainLooper(); compose.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty()
    }

    @Test fun tailscaleOff() {
        FakeHttp(
            mapOf(
                "/api/health" to (200 to """{"ok":true,"app":"journeys","instance":"inst-1","authRequired":false}"""),
                "/api/homebase" to (200 to """{"apps":[{"id":"journeys","name":"Journeys","path":"/","token":true,"subtitle":"1 waiting · 1 habit left","badge":2}]}"""),
                "/" to (200 to "<html><title>Journeys</title></html>"),
            ),
        ).use { lan ->
            val state = compose.activity.state
            val url = "http://alpha5.invalid:${ServerSocket(0).use { it.localPort }}"
            compose.runOnUiThread {
                state.saveServer(url, Net.Check.Ok("alpha5", listOf(HomeApp("journeys", "Journeys", "$url/", 0xFF2451D6, "journeys", "1 waiting · 1 habit left", 2, true)), 5, true, false, "inst-1"))
                state.store.setInstance(url, "inst-1")
                state.link = Link.CheckingWifi
                state.status = mapOf("journeys" to AppStatus.Checking)
            }
            waitFor("looking on your Wi-Fi")
            shot("w1-looking")

            compose.runOnUiThread { state.store.setLanAddress(url, lan.base); state.refresh() }
            waitFor("using home Wi-Fi")
            waitFor("On home Wi-Fi")
            shot("w2-home-wifi")

            compose.runOnUiThread { state.store.setLanAddress(url, "http://127.0.0.1:${ServerSocket(0).use { it.localPort }}") }
            lan.close()
            compose.runOnUiThread { state.refresh() }
            waitFor("Tailscale is off · offline")
            waitFor("Offline · Tailscale is off")
            shot("w3-offline")
        }
    }
}
