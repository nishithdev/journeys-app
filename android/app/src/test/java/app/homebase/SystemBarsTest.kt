package app.homebase

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.core.view.WindowCompat
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Status bar icons must stay readable: dark on Homebase's light screens even in dark mode, white over an open app's dark bar. */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-night-xxhdpi")
class SystemBarsTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private fun lightIcons(): Boolean = !WindowCompat.getInsetsController(compose.activity.window, compose.activity.window.decorView).isAppearanceLightStatusBars

    @Test fun iconsFollowTheScreen() {
        compose.waitForIdle()
        assertFalse("setup screen is light, so the clock and battery must be dark", lightIcons())
        val st = compose.activity.state
        compose.runOnUiThread { st.screen = Screen.Settings }
        compose.waitForIdle()
        assertFalse(lightIcons())
        compose.runOnUiThread { st.locked = true }
        compose.waitForIdle()
        assertTrue("lock screen is dark, so the icons must be white", lightIcons())
    }
}
