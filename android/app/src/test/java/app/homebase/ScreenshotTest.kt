package app.homebase

import android.graphics.Bitmap
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** Renders the real screens to PNGs under build/screens (only when HOMEBASE_TEST_OPEN_SERVER is set). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h891dp-xhdpi")
class ScreenshotTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val server = System.getProperty("homebase.openServer").orEmpty()
    private val out = File("build/screens").apply { mkdirs() }

    private fun shot(name: String) {
        compose.waitForIdle()
        compose.activityRule.scenario.onActivity { a ->
            val v = a.window.decorView
            val bmp = Bitmap.createBitmap(v.width, v.height, Bitmap.Config.ARGB_8888)
            v.draw(android.graphics.Canvas(bmp))
            File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
    }
    private fun waitForText(t: String) = compose.waitUntil(20_000) { compose.onAllNodesWithText(t, substring = true).fetchSemanticsNodes().isNotEmpty() }

    @Test fun screens() {
        assumeTrue(server.isNotEmpty())
        compose.onNode(hasSetTextAction()).performTextReplacement(server.removePrefix("http://"))
        shot("1-setup")
        compose.onNodeWithText("Connect").performScrollTo().performClick()
        waitForText("Continue")
        shot("2-check")
        compose.onNodeWithText("Continue").performScrollTo().performClick()
        waitForText("waiting")
        shot("3-launcher")
        compose.onNodeWithContentDescription("Settings").performClick()
        waitForText("Forget this server")
        shot("4-settings")
    }
}
