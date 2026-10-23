package app.homebase

import java.net.InetAddress
import java.net.ServerSocket
import kotlin.concurrent.thread

/** A tiny HTTP server for tests, on a real socket: path -> (status, body). */
class FakeHttp(private val routes: Map<String, Pair<Int, String>>) : AutoCloseable {
    private val socket = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    val port: Int get() = socket.localPort
    val base: String get() = "http://127.0.0.1:$port"

    init {
        thread(isDaemon = true) {
            while (!socket.isClosed) {
                val c = try { socket.accept() } catch (e: Exception) { break }
                thread(isDaemon = true) {
                    c.use {
                        val reader = c.getInputStream().bufferedReader()
                        val path = reader.readLine()?.split(" ")?.getOrNull(1)?.substringBefore('?') ?: "/"
                        while (reader.readLine()?.isNotEmpty() == true) { /* headers */ }
                        val (code, body) = routes[path] ?: (404 to "not found")
                        val bytes = body.toByteArray()
                        c.getOutputStream().apply {
                            write("HTTP/1.1 $code X\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                            write(bytes)
                            flush()
                        }
                    }
                }
            }
        }
    }

    override fun close() = socket.close()
}
