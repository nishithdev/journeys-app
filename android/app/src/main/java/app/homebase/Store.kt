package app.homebase

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Settings and the server list, kept on the phone. Access tokens are encrypted with a key in the Android Keystore. */
class Store(context: Context) {
    private val p = context.getSharedPreferences("homebase", Context.MODE_PRIVATE)
    private val crypto = TokenCrypto()

    var servers: List<Server>
        get() = Model.serversFromJson(p.getString("servers", null))
        set(v) = p.edit().putString("servers", Model.serversToJson(v)).apply()

    var currentUrl: String?
        get() = p.getString("current", null)
        set(v) = p.edit().putString("current", v).apply()

    /** "list" for the launcher, or an app id to open straight away. */
    var openOnLaunch: String
        get() = p.getString("openOnLaunch", "list") ?: "list"
        set(v) = p.edit().putString("openOnLaunch", v).apply()

    var lockEnabled: Boolean
        get() = p.getBoolean("lock", false)
        set(v) = p.edit().putBoolean("lock", v).apply()

    var warnTailscale: Boolean
        get() = p.getBoolean("warnTailscale", true)
        set(v) = p.edit().putBoolean("warnTailscale", v).apply()

    fun token(serverUrl: String): String? = p.getString("token:$serverUrl", null)?.let { crypto.decrypt(it) }

    fun setToken(serverUrl: String, token: String?) {
        if (token.isNullOrBlank()) p.edit().remove("token:$serverUrl").apply()
        else p.edit().putString("token:$serverUrl", crypto.encrypt(token.trim())).apply()
    }

    /** Last app list from the server, so the launcher shows instantly and works offline. */
    fun cachedApps(serverUrl: String): List<HomeApp> = Model.appsFromJson(p.getString("apps:$serverUrl", null))
    fun saveApps(serverUrl: String, apps: List<HomeApp>) = p.edit().putString("apps:$serverUrl", Model.appsToJson(apps)).apply()

    fun manualApps(serverUrl: String): List<HomeApp> = Model.appsFromJson(p.getString("manual:$serverUrl", null))
    fun saveManualApps(serverUrl: String, apps: List<HomeApp>) = p.edit().putString("manual:$serverUrl", Model.appsToJson(apps)).apply()

    /** Found services you chose "Not now" for, so the launcher stops offering them. */
    fun hiddenFound(serverUrl: String): Set<String> = p.getStringSet("hidden:$serverUrl", emptySet()) ?: emptySet()
    fun hideFound(serverUrl: String, keys: Collection<String>) =
        p.edit().putStringSet("hidden:$serverUrl", hiddenFound(serverUrl) + keys).apply()

    /** How often each app was opened, so Homebase can load your favourite ahead of time. */
    fun opens(serverUrl: String, appId: String): Int = p.getInt("opens:$serverUrl:$appId", 0)
    fun countOpen(serverUrl: String, appId: String) = p.edit().putInt("opens:$serverUrl:$appId", opens(serverUrl, appId) + 1).apply()

    /** The server's install ID, used to recognise it on home Wi-Fi when Tailscale is off. */
    fun instance(serverUrl: String): String = p.getString("instance:$serverUrl", "") ?: ""
    fun setInstance(serverUrl: String, id: String) { if (id.isNotBlank()) p.edit().putString("instance:$serverUrl", id).apply() }
    /** Where the server answered on home Wi-Fi last time (tried first next time). */
    fun lanAddress(serverUrl: String): String = p.getString("lan:$serverUrl", "") ?: ""
    fun setLanAddress(serverUrl: String, origin: String) = p.edit().putString("lan:$serverUrl", origin).apply()

    fun forget(serverUrl: String) {
        servers = servers.filter { it.url != serverUrl }
        p.edit().remove("token:$serverUrl").remove("apps:$serverUrl").remove("manual:$serverUrl").remove("hidden:$serverUrl").apply()
        if (currentUrl == serverUrl) currentUrl = servers.firstOrNull()?.url
    }
}

/** AES-GCM with a key that never leaves the Android Keystore. */
private class TokenCrypto {
    private val alias = "homebase-token-key"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    fun encrypt(plain: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val out = c.doFinal(plain.toByteArray(Charsets.UTF_8))
        return b64(c.iv) + ":" + b64(out)
    }

    fun decrypt(stored: String): String? = try {
        val (iv, data) = stored.split(":", limit = 2)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, unb64(iv)))
        String(c.doFinal(unb64(data)), Charsets.UTF_8)
    } catch (e: Exception) { null }

    private fun b64(b: ByteArray) = Base64.encodeToString(b, Base64.NO_WRAP)
    private fun unb64(s: String) = Base64.decode(s, Base64.NO_WRAP)
}
