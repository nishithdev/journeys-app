package app.homebase

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelTest {
    @Test fun normalizesAddresses() {
        assertEquals("http://alpha5.tail1234.ts.net:8080", Model.normalizeUrl("alpha5.tail1234.ts.net:8080"))
        assertEquals("http://alpha5.local:8080", Model.normalizeUrl(" http://Alpha5.local:8080/#/ "))
        assertEquals("https://journeys.example.com", Model.normalizeUrl("https://journeys.example.com/"))
        assertEquals("http://100.64.0.5:8080/sub", Model.normalizeUrl("100.64.0.5:8080/sub/"))
        assertNull(Model.normalizeUrl(""))
        assertNull(Model.normalizeUrl("ftp://x"))
        assertNull(Model.normalizeUrl("http://"))
    }

    @Test fun originsAndNames() {
        assertEquals("http://alpha5:8080", Model.origin("http://alpha5:8080/#/goals"))
        assertEquals("alpha5", Model.serverName("http://alpha5.tail1234.ts.net:8080"))
        assertEquals("100.64.0.5", Model.serverName("http://100.64.0.5:8080"))
    }

    @Test fun readsTheServersAppList() {
        val json = """
            {"server":{"name":"alpha5"},"apps":[
              {"id":"journeys","name":"Journeys","path":"/","color":"#2451D6","icon":"journeys","subtitle":"2 waiting","badge":2,"token":true},
              {"id":"ha","name":"Home Assistant","url":"http://alpha5:8123","color":"#18BCF2","icon":"home"},
              {"id":"broken","name":"","url":"http://x"},
              {"id":"nourl","name":"No address"}
            ]}""".trimIndent()
        val (name, apps) = Model.parseApps("http://alpha5:8080", json)
        assertEquals("alpha5", name)
        assertEquals(listOf("journeys", "ha"), apps.map { it.id })
        assertEquals("http://alpha5:8080/", apps[0].url)
        assertEquals(0xFF2451D6, apps[0].color)
        assertEquals(2, apps[0].badge)
        assertTrue(apps[0].injectToken)
        assertFalse(apps[1].injectToken)
    }

    @Test fun storesAppsAndServersAsJson() {
        val apps = listOf(HomeApp("a", "A", "http://a", 0xFF112233, "web", "sub", 3, true, true))
        assertEquals(apps, Model.appsFromJson(Model.appsToJson(apps)))
        val servers = listOf(Server("http://alpha5:8080", "alpha5"))
        assertEquals(servers, Model.serversFromJson(Model.serversToJson(servers)))
        assertEquals(emptyList<HomeApp>(), Model.appsFromJson("not json"))
    }

    @Test fun tokenScriptQuotesTheToken() {
        val s = Model.tokenScript("ab'c\"d")
        assertTrue(s.contains("\"ab'c\\\"d\""))
        assertTrue(s.startsWith("(function(){"))
    }

    @Test fun colors() {
        assertEquals(0xFF18BCF2, Model.parseColor("#18BCF2", 0))
        assertEquals(7L, Model.parseColor("nope", 7))
    }
}
