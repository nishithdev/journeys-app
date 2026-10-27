package app.homebase

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper
import java.net.ServerSocket
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-xhdpi")
class WifiSetupTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
    private val host = System.getProperty("homebase.discoveryHost").orEmpty()

    private fun pumpUntil(ms: Long = 20_000, done: () -> Boolean): Boolean {
        val until = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < until) {
            ShadowLooper.idleMainLooper(100, TimeUnit.MILLISECONDS); runCatching { compose.mainClock.advanceTimeBy(100); compose.waitForIdle() }
            if (done()) return true
            Thread.sleep(40)
        }
        return false
    }

    @Test fun sweepFindsWhatIsListening() = runBlocking {
        val closed = ServerSocket(0).use { it.localPort }
        FakeHttp(mapOf("/api/health" to (200 to """{"ok":true,"app":"journeys","instance":"i-1","authRequired":false}"""))).use { j ->
            val found = mutableListOf<Found>()
            LocalScan.sweep(listOf("127.0.0.1"), listOf(j.port, closed)) { synchronized(found) { found += it } }
            assertEquals(1, found.size)
            assertEquals("journeys", found.single().kind)
            assertEquals("i-1", found.single().instance)
        }
    }

    @Test fun connectsByItselfWhenTheWifiHasOneJourneys() {
        assumeTrue(host.isNotEmpty()) // a Journeys without APP_TOKEN at host:8080
        val state = compose.activity.state
        // What the Wi-Fi search would find: one Journeys.
        compose.runOnUiThread { state.scanHost(host, ports = listOf(8080)) }
        assertTrue("no offer to connect", pumpUntil { compose.onAllNodesWithText("Found Journeys on your Wi-Fi").fetchSemanticsNodes().isNotEmpty() })
        val went = pumpUntil { state.screen is Screen.Check }
        assertTrue("it didn't go on to connect: screen=${state.screen} card=${compose.onAllNodesWithText("Found Journeys on your Wi-Fi").fetchSemanticsNodes().size} found=${state.found.map { it.url }}", went)
        assertEquals(Screen.Check("http://$host:8080"), state.screen)
    }

    @Test fun claudeAccessSaysWhyItIsNotReporting() {
        // A server that isn't Journeys: reports get a 404.
        FakeHttp(mapOf("/" to (200 to "<html>other</html>"), "/api/health" to (200 to "{}"))).use { other ->
            val state = HomebaseState(Store(ctx), ctx, MainScope())
            state.saveServer(other.base, Net.Check.Ok("beta", listOf(HomeApp("web", "Other", other.base + "/")), 3, false, false))
            state.remote.start()
            assertTrue(state.remote.status.toString(), pumpUntil { state.remote.status.problem.contains("doesn't take reports") })
            state.remote.stop()
        }
        // A server that takes them: "Reporting".
        FakeHttp(mapOf("/api/homebase/report" to (200 to """{"ok":true,"last_seq":2}"""), "/api/homebase/commands" to (200 to """{"commands":[]}"""))).use { ok ->
            val state = HomebaseState(Store(ctx), ctx, MainScope())
            state.saveServer(ok.base, Net.Check.Ok("alpha5", listOf(HomeApp("journeys", "Journeys", ok.base + "/")), 3, true, false))
            state.remote.start()
            assertTrue(state.remote.status.toString(), pumpUntil { state.remote.status.lastOkAt > 0 && state.remote.status.problem.isEmpty() })
            state.remote.stop()
        }
    }
}
