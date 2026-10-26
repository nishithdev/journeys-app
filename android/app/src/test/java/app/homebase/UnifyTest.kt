package app.homebase

import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.MainScope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLooper

/** The same machine seen on Wi-Fi and over Tailscale is one entry, kept at the address that works everywhere. */
@RunWith(RobolectricTestRunner::class)
class UnifyTest {
    private val lan = Found("http://192.168.1.20:3000/", "Life Quest", "life-quest", instance = "abc-123")
    private val tail = Found("http://alpha5:3000/", "Life Quest", "life-quest", subtitle = "LV 29", instance = "abc-123")

    @Test fun ranksAddressesByWhereTheyWork() {
        assertEquals(0, Unify.reach("http://alpha5:8080"))
        assertEquals(0, Unify.reach("http://alpha5.tail1234.ts.net:8080"))
        assertEquals(0, Unify.reach("http://100.101.7.3:8080"))
        assertEquals(2, Unify.reach("http://192.168.1.20:8080"))
        assertEquals(2, Unify.reach("http://10.0.0.4:8080"))
        assertEquals(2, Unify.reach("http://alpha5.local:8080"))
        assertEquals(1, Unify.reach("http://8.8.8.8"))
        assertEquals(2, Unify.reach("http://localhost:8080"))
    }

    @Test fun mergeKeepsTheTailscaleAddressFirst() {
        for ((a, b) in listOf(lan to tail, tail to lan)) {
            val m = Unify.merge(a, b)
            assertEquals("http://alpha5:3000/", m.url)
            assertEquals(listOf("http://192.168.1.20:3000/"), m.alts)
            assertEquals("LV 29", m.subtitle)
            assertEquals("abc-123", m.instance)
        }
    }

    @Test fun identityFallsBackToNameAndPort() {
        val ha1 = Found("http://192.168.1.20:8123/", "Home Assistant", "home-assistant")
        val ha2 = Found("http://alpha5:8123/", "Home Assistant", "home-assistant")
        assertEquals(ha1.identity, ha2.identity)
        val p1 = Found("http://192.168.1.20:9000/", "Web app", "web")
        val p2 = Found("http://alpha5:9000/", "Web app", "web")
        assertTrue("untitled pages are only the same at the same address", p1.identity != p2.identity)
    }

    @Test fun oneEntryWhenFoundAtTwoAddresses() {
        // Life Quest answers at both "localhost" and "127.0.0.1", like a Pi at its Tailscale name and its Wi-Fi IP.
        FakeHttp(
            mapOf(
                "/api/health" to (200 to """{"ok":true,"app":"life-quest","instance":"abc-123","authRequired":false}"""),
                "/api/homebase" to (200 to """{"apps":[{"id":"life-quest","name":"Life Quest","path":"/","subtitle":"LV 29"}]}"""),
            ),
        ).use { lq ->
            val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
            val state = HomebaseState(Store(ctx), ctx, MainScope())
            state.scanHost("127.0.0.1", ports = listOf(lq.port))
            state.scanHost("localhost", ports = listOf(lq.port))
            val until = System.currentTimeMillis() + 10_000
            while (state.scanning > 0 && System.currentTimeMillis() < until) { Thread.sleep(50); ShadowLooper.idleMainLooper() }
            assertEquals(state.found.toString(), 1, state.found.size)
            val f = state.found.single()
            assertEquals(setOf("http://localhost:${lq.port}/", "http://127.0.0.1:${lq.port}/"), f.urls.toSet())
            assertEquals(setOf("http://localhost:${lq.port}", "http://127.0.0.1:${lq.port}"), state.aliases("http://127.0.0.1:${lq.port}/").map { it.trimEnd('/') }.toSet())
        }
    }
}
