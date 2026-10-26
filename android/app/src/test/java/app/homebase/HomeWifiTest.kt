package app.homebase

import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLooper
import java.net.ServerSocket

/** Tailscale off: look for the server on home Wi-Fi, use it there if found, otherwise say offline. */
@RunWith(RobolectricTestRunner::class)
class HomeWifiTest {
    private val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
    private fun journeys(instance: String) = mapOf(
        "/api/health" to (200 to """{"ok":true,"app":"journeys","instance":"$instance","authRequired":false}"""),
        "/api/homebase" to (200 to """{"apps":[{"id":"journeys","name":"Journeys","path":"/","token":true}]}"""),
        "/" to (200 to "<html><title>Journeys</title></html>"),
    )

    /** A server saved at its Tailscale name, which doesn't answer (Tailscale is off). */
    private fun stateWithServer(): Pair<HomebaseState, String> {
        val dead = ServerSocket(0).use { it.localPort }
        val url = "http://alpha5.invalid:$dead"
        val state = HomebaseState(Store(ctx), ctx, MainScope())
        state.saveServer(url, Net.Check.Ok("alpha5", listOf(HomeApp("journeys", "Journeys", "$url/", injectToken = true)), 5, true, false, "inst-1"))
        state.store.setInstance(url, "inst-1")
        return state to url
    }

    /** Runs the main looper until [done] holds (or 20 s pass). */
    private fun settle(state: HomebaseState, done: () -> Boolean) {
        val until = System.currentTimeMillis() + 20_000
        while (System.currentTimeMillis() < until && !done()) { ShadowLooper.idleMainLooper(); Thread.sleep(30) }
    }

    @Test fun usesTheServerOnHomeWifi() {
        FakeHttp(journeys("inst-1")).use { lan ->
            val (state, url) = stateWithServer()
            state.store.setLanAddress(url, lan.base) // where it answered on Wi-Fi last time
            state.refresh()
            settle(state) { state.link == Link.HomeWifi && state.status["journeys"] == AppStatus.Up }
            val seen = state.linkTrail.toList()
            assertEquals(seen.toString(), Link.HomeWifi, state.link)
            assertTrue("it looked on Wi-Fi first: $seen", seen.indexOf(Link.CheckingWifi) in 0 until seen.indexOf(Link.HomeWifi))
            assertEquals("${lan.base}/", state.urlFor(state.apps.single()))
            assertEquals("status=${state.status} routes=${state.routes}", AppStatus.Up, state.status["journeys"])
        }
    }

    @Test fun offlineWhenItIsntOnThisWifiEither() {
        val (state, url) = stateWithServer()
        state.store.setLanAddress(url, "http://127.0.0.1:${ServerSocket(0).use { it.localPort }}")
        state.refresh()
        settle(state) { state.link == Link.TailscaleOff && state.status["journeys"] == AppStatus.Down }
        val seen = state.linkTrail.toList()
        assertEquals(seen.toString(), Link.TailscaleOff, state.link)
        assertTrue("it looked on Wi-Fi before saying offline: $seen", seen.indexOf(Link.CheckingWifi) in 0 until seen.indexOf(Link.TailscaleOff))
        assertEquals(url + "/", state.urlFor(state.apps.single()))
        assertEquals("status=${state.status}", AppStatus.Down, state.status["journeys"])
    }

    @Test fun findsTheServerByItsIdAmongNeighbours() = runBlocking {
        FakeHttp(journeys("other")).use { stranger ->
            FakeHttp(journeys("inst-1")).use { mine ->
                // Same port for the scan: the stranger and mine live on different loopback addresses in real life;
                // here they differ by port, so scan each port and check only the right ID matches.
                assertNull(LocalScan.find(listOf("127.0.0.1"), stranger.port, "http", "inst-1", "journeys"))
                assertEquals("http://127.0.0.1:${mine.port}", LocalScan.find(listOf("127.0.0.2", "127.0.0.1"), mine.port, "http", "inst-1", "journeys"))
            }
        }
    }

    @Test fun neighboursAreTheRestOfTheWifi() {
        val me = java.net.InetAddress.getByName("192.168.8.37") as java.net.Inet4Address
        val n = LocalScan.neighbours(me)
        assertEquals(253, n.size)
        assertTrue("192.168.8.37" !in n)
        assertEquals("192.168.8.1", n.first()) // the router end of the range is tried early
    }
}
