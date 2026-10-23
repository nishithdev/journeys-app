package app.homebase

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import androidx.activity.compose.setContent
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import app.homebase.ui.HomebaseRoot
import app.homebase.ui.HomebaseTheme

class MainActivity : FragmentActivity() {
    lateinit var state: HomebaseState

    // A web page asked for a file (e.g. attaching a PDF): Android's picker, then back to the page.
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
        fileCallback = null
    }

    fun chooseFiles(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
        fileCallback?.onReceiveValue(null)
        fileCallback = callback
        return try {
            filePicker.launch(params.createIntent()); true
        } catch (e: ActivityNotFoundException) {
            fileCallback = null; false
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Homebase is always light, so ask for dark status bar icons even when the phone is in dark mode.
        // HomebaseRoot switches them per screen (white icons over the dark bar of an open app).
        val clear = android.graphics.Color.TRANSPARENT
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.light(clear, clear), navigationBarStyle = SystemBarStyle.light(clear, clear))
        state = HomebaseState(Store(this), applicationContext, lifecycleScope)
        handleIntent(intent)
        setContent { HomebaseTheme { HomebaseRoot(state, this) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    /** homebase://connect?url=… (e.g. from a link on your server) opens setup with the address filled in. */
    private fun handleIntent(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme == "homebase" && data.host == "connect") {
            data.getQueryParameter("url")?.let { state.screen = Screen.Setup(it) }
        }
    }

    override fun onStart() {
        super.onStart()
        state.onStart(canLock())
    }

    override fun onStop() {
        super.onStop()
        state.onStop()
    }

    fun canLock(): Boolean =
        BiometricManager.from(this).canAuthenticate(BIOMETRIC_WEAK or DEVICE_CREDENTIAL) == BiometricManager.BIOMETRIC_SUCCESS

    fun unlock() {
        if (!canLock()) { state.locked = false; return } // screen lock was removed: nothing to check against
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { state.locked = false }
        })
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock Homebase")
                .setSubtitle("Your homelab apps stay private until you unlock")
                .setAllowedAuthenticators(BIOMETRIC_WEAK or DEVICE_CREDENTIAL)
                .build()
        )
    }
}
