package app.homebase

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Checks against a real Journeys server (HOMEBASE_TEST_SERVER + HOMEBASE_TEST_TOKEN); skipped without one. */
@RunWith(RobolectricTestRunner::class)
class NetTest {
    private val server = System.getProperty("homebase.server").orEmpty()
    private val token = System.getProperty("homebase.token").orEmpty()

    @Test fun asksForATokenWhenTheServerNeedsOne() = runBlocking {
        assumeTrue(server.isNotEmpty())
        assertEquals(Net.Check.NeedsToken, Net.check(server, null))
    }

    @Test fun saysWhenTheTokenIsWrong() = runBlocking {
        assumeTrue(server.isNotEmpty())
        assertEquals(Net.Check.BadToken, Net.check(server, "not-the-token"))
    }

    @Test fun listsTheServersAppsWithTheRightToken() = runBlocking {
        assumeTrue(server.isNotEmpty() && token.isNotEmpty())
        val r = Net.check(server, token)
        assertTrue("got $r", r is Net.Check.Ok)
        r as Net.Check.Ok
        assertTrue(r.isJourneys)
        val journeys = r.apps.first { it.id == "journeys" }
        assertTrue(journeys.injectToken)
        assertEquals("$server/", journeys.url)
        assertTrue(r.apps.any { it.name == "Home Assistant" })
    }

    @Test fun reportsAnUnreachableServer() = runBlocking {
        val r = Net.check("http://127.0.0.1:9", null)
        assertTrue("got $r", r is Net.Check.Unreachable)
    }
}
