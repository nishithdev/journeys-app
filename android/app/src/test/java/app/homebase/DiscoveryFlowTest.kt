package app.homebase

import android.graphics.Bitmap
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Type a host name, see what runs on it (Journeys on 8080, Life Quest on 3000), connect to one,
 * and bring the other along. Needs both running on HOMEBASE_TEST_DISCOVERY_HOST, Journeys without APP_TOKEN (skipped otherwise).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h891dp-xhdpi")
class DiscoveryFlowTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val host = System.getProperty("homebase.discoveryHost").orEmpty()
    private val out = File("build/screens").apply { mkdirs() }

    private fun shot(name: String) {
        repeat(10) { Thread.sleep(100); compose.waitForIdle() }
        compose.activityRule.scenario.onActivity { a ->
            val v = a.window.decorView
            val bmp = Bitmap.createBitmap(v.width, v.height, Bitmap.Config.ARGB_8888)
            v.draw(android.graphics.Canvas(bmp))
            File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
    }
    private fun waitForText(t: String, ms: Long = 20_000) =
        compose.waitUntil(ms) { compose.onAllNodesWithText(t, substring = true).fetchSemanticsNodes().isNotEmpty() }

    @Test fun findsServicesOnAHostAndAddsThem() {
        assumeTrue(host.isNotEmpty())
        compose.onNode(hasSetTextAction()).performTextReplacement(host)
        waitForText("port 8080")
        waitForText("port 3000")
        shot("d1-found")

        compose.onNode(hasText("port 8080", substring = true)).performScrollTo().performClick()
        // (A token can't be saved here: the test runner has no Android Keystore. Point this at a Journeys without APP_TOKEN.)
        waitForText("ALSO RUNNING ON")
        waitForText("Life Quest")
        shot("d2-also")

        // Like an older setup: connect with just Journeys (untick Life Quest)…
        compose.onNode(hasText("port 3000", substring = true)).performScrollTo().performClick()
        compose.onAllNodesWithText("Continue", substring = true)[0].performScrollTo().performClick()
        waitForText("Add an app")
        // …and the launcher offers what it found next to the server.
        waitForText("New app found")
        shot("d3-launcher-new")
        compose.onNodeWithText("Review").performClick()
        waitForText("These are running next to your server")
        shot("d3b-menu")
        compose.onAllNodesWithText("Add")[0].performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("New app found").fetchSemanticsNodes().isEmpty() }
        shot("d3c-added")
        val state = compose.activity.state
        assertEquals(1, state.apps.count { it.name == "Life Quest" })
        assertEquals(1, state.apps.count { it.name == "Journeys" })

        // Running dots: both answer; an app on a port with nothing behind it shows as not responding.
        val closed = java.net.ServerSocket(0).use { it.localPort }
        compose.runOnUiThread { state.addManualApp("Stopped app", "http://127.0.0.1:$closed") }
        // Let the checks finish (their results come back through the main looper).
        val until = System.currentTimeMillis() + 15_000
        while (!state.apps.all { state.status[it.id] == AppStatus.Up || state.status[it.id] == AppStatus.Down } && System.currentTimeMillis() < until) {
            Thread.sleep(100)
            org.robolectric.shadows.ShadowLooper.idleMainLooper()
            compose.waitForIdle()
        }
        assertEquals(AppStatus.Up, state.status[state.apps.first { it.name == "Journeys" }.id])
        assertEquals(AppStatus.Up, state.status[state.apps.first { it.name == "Life Quest" }.id])
        assertEquals(AppStatus.Down, state.status[state.apps.first { it.name == "Stopped app" }.id])
        waitForText("Not responding")
        shot("d4-status")

        // Opening an app: a cover in its colour fills the wait, never a white page.
        compose.onNode(hasText("Journeys") and hasText("journeys", substring = true, ignoreCase = true)).performClick()
        waitForText("Opening on")
        shot("d5-opening")
        compose.waitUntil(20_000) { compose.onAllNodesWithText("Still loading", substring = true).fetchSemanticsNodes().isNotEmpty() }
        shot("d6-slow")
    }
}
