package app.homebase

import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.net.ServerSocket

@RunWith(RobolectricTestRunner::class)
class OpeningTest {
    private val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()

    @Test fun readsWhatThePageReports() {
        val ps = Opening.parsePage("\"here|complete|drawn|Syncing\\u2026\"")
        assertTrue(ps.here && ps.loaded && ps.drawn)
        assertFalse("still syncing", ps.dataDone)
        assertTrue(Opening.parsePage("\"here|interactive|drawn|Synced\"").dataDone)
        assertFalse(Opening.parsePage("\"here|loading|boot|\"").drawn)
        assertFalse(Opening.parsePage("\"away|complete|drawn|\"").here)
        assertFalse(Opening.parsePage(null).here)
    }

    @Test fun wifiAddressesDontNeedTailscale() {
        assertFalse(Opening.needsTailscale("http://192.168.1.20:8080"))
        assertTrue(Opening.needsTailscale("http://alpha5:8080"))
        assertTrue(Opening.needsTailscale("http://100.101.7.3:8080"))
    }

    @Test fun saysWhichPartIsDown() = runBlocking {
        val closed = ServerSocket(0).use { it.localPort }
        FakeHttp(mapOf("/" to (200 to "ok"))).use { server ->
            val srv = Server(server.base, "alpha5")
            // The server answers but this app's port doesn't: the app isn't running.
            val down = Opening.diagnose(ctx, HomeApp("x", "Life Quest", "http://127.0.0.1:$closed"), srv, checkTailscale = false)
            assertTrue(down.toString(), down is Problem.AppDown)
            assertEquals("Life Quest isn't running", down!!.title)
            // The app answers: nothing wrong.
            assertNull(Opening.diagnose(ctx, HomeApp("j", "Journeys", server.base), srv, checkTailscale = false))
        }
        // Nothing answers at all: the server is down.
        val gone = Opening.diagnose(ctx, HomeApp("j", "Journeys", "http://127.0.0.1:$closed"), Server("http://127.0.0.1:$closed", "alpha5"), checkTailscale = false)
        assertEquals("alpha5 isn't answering", gone!!.title)
    }

    @Test fun keepsAndForgetsTheLastView() = runBlocking {
        val bmp = android.graphics.Bitmap.createBitmap(10, 20, android.graphics.Bitmap.Config.ARGB_8888)
        Snapshots.save(ctx, "http://alpha5:8080", "journeys", bmp)
        assertNotNull(Snapshots.load(ctx, "http://alpha5:8080", "journeys"))
        assertNull("other servers don't share it", Snapshots.load(ctx, "http://beta:8080", "journeys"))
        Snapshots.forget(ctx, "http://alpha5:8080")
        assertNull(Snapshots.load(ctx, "http://alpha5:8080", "journeys"))
    }
}
