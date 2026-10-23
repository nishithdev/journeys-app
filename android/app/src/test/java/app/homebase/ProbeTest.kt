package app.homebase

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.net.ServerSocket

/** Finding what runs on a host's ports, like 8080 (Journeys) and 3000 (Life Quest). */
@RunWith(RobolectricTestRunner::class)
class ProbeTest {
    private val lifeQuest = mapOf(
        "/api/health" to (200 to """{"ok":true,"app":"life-quest","version":"0.1.0","authRequired":false}"""),
        "/api/homebase" to (200 to """{"apps":[{"id":"life-quest","name":"Life Quest","path":"/","color":"#14151f","icon":"quest","iconUrl":"/api/homebase/icon.png","subtitle":"LV 29 in 2 days · 13 steps ready","badge":1}]}"""),
        "/" to (200 to "<html><title>Life Quest</title></html>"),
    )
    private val journeys = mapOf(
        "/api/health" to (200 to """{"ok":true,"app":"journeys","version":"2.6.0","authRequired":true}"""),
        "/api/homebase" to (401 to """{"error":"Wrong or missing access token"}"""),
        "/" to (200 to "<html><title>Journeys</title></html>"),
    )
    private val homeAssistant = mapOf("/" to (200 to "<!DOCTYPE html><html><head><title>Home Assistant</title></head></html>"))
    private val grafana = mapOf(
        "/api/health" to (200 to """{"database":"ok"}"""),
        "/" to (200 to "<html><head>\n  <title>\n Grafana \n</title></head></html>"),
    )

    @Test fun findsEveryServiceOnAHostAndSkipsClosedPorts() = runBlocking {
        val closed = ServerSocket(0).use { it.localPort } // a port with nothing on it
        FakeHttp(lifeQuest).use { lq ->
            FakeHttp(journeys).use { j ->
                FakeHttp(homeAssistant).use { ha ->
                    FakeHttp(grafana).use { g ->
                        val found = Probe.host("127.0.0.1", listOf(j.port, lq.port, ha.port, g.port, closed), timeoutMs = 1500)
                        val byPort = found.associateBy { it.port }
                        assertEquals(4, found.size)
                        assertNull("nothing runs there", byPort[closed])

                        val q = byPort.getValue(lq.port)
                        assertEquals("Life Quest", q.name)
                        assertEquals("life-quest", q.kind)
                        assertEquals("${lq.base}/api/homebase/icon.png", q.iconUrl)
                        assertTrue(q.subtitle.startsWith("LV 29"))

                        assertEquals("Journeys", byPort.getValue(j.port).name)
                        assertEquals("journeys", byPort.getValue(j.port).kind)
                        assertEquals("home-assistant", byPort.getValue(ha.port).kind)

                        val other = byPort.getValue(g.port)
                        assertEquals("Grafana", other.name)
                        assertFalse("not added unless you tick it", other.known)
                        assertEquals("found-127.0.0.1-${lq.port}", q.toApp().id)
                    }
                }
            }
        }
    }

    @Test fun aliveIsTrueOnlyWhenSomethingAnswers() = runBlocking {
        val closed = ServerSocket(0).use { it.localPort }
        val t0 = System.currentTimeMillis()
        assertFalse(Probe.alive("http://127.0.0.1:$closed"))
        assertTrue("a closed port answers at once", System.currentTimeMillis() - t0 < 2500)
        FakeHttp(mapOf("/" to (302 to ""))).use { assertTrue("a redirect to a login page still counts", Probe.alive(it.base)) }
        FakeHttp(mapOf("/x" to (200 to ""))).use { assertTrue("404 means it's running", Probe.alive(it.base)) }
    }

    @Test fun readsPageTitles() {
        assertEquals("Immich", Probe.titleOf("<html><head><TITLE>Immich</TITLE>"))
        assertNull(Probe.titleOf("<html>no title</html>"))
    }

    @Test fun sameAddressIsOneEntry() {
        assertEquals(HomebaseState.sameKey("http://alpha5:3000/"), HomebaseState.sameKey("http://Alpha5:3000"))
        assertEquals(HomebaseState.sameKey("http://alpha5:80/"), HomebaseState.sameKey("http://alpha5"))
    }
}
