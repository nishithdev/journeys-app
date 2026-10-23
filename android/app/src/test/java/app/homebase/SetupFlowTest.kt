package app.homebase

import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import androidx.compose.ui.test.performScrollTo

/** The whole first run: type the address, check the server, continue to the launcher, open Settings. */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-xxhdpi")
class SetupFlowTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val server = System.getProperty("homebase.openServer").orEmpty()

    private fun waitForText(text: String, ms: Long = 20_000) =
        compose.waitUntil(ms) { compose.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty() }

    @Test fun connectsAndShowsTheLauncher() {
        assumeTrue(server.isNotEmpty())
        compose.onNodeWithText("Connect your homelab").assertExists()
        compose.onNode(hasSetTextAction()).performTextReplacement(server.removePrefix("http://"))
        compose.onNodeWithText("Connect").performScrollTo().performClick()
        waitForText("Continue")
        compose.onNodeWithText("Reached your server").assertExists()
        compose.onNodeWithText("Plain http").assertExists()
        compose.onNodeWithText("Continue").performScrollTo().performClick()
        waitForText("Add an app")
        compose.onNodeWithText("Journeys").assertExists()
        waitForText("waiting") // the server's badge text, e.g. "1 waiting · 1 habit left"
        compose.onNodeWithContentDescription("Settings").performClick()
        waitForText("Forget this server")
        compose.onNodeWithText("Open on launch").assertExists()
    }

    @Test fun rejectsANonsenseAddress() {
        compose.onNode(hasSetTextAction()).performTextReplacement("ftp://nope")
        compose.onNodeWithText("Connect").performScrollTo().performClick()
        compose.onNodeWithText("doesn't look like an address", substring = true).assertExists()
    }
}
