package com.nimbalyst.app.transcript

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class TranscriptBridgeTest {
    @Test
    fun `parses prompt payload`() {
        var message: TranscriptBridgeMessage? = null
        val bridge = TranscriptBridge { message = it }

        bridge.postMessage("""{"type":"prompt","text":"Ship the Android prompt queue"}""")

        assertNotNull(message)
        assertEquals("prompt", message?.type)
        assertEquals("Ship the Android prompt queue", message?.text)
    }

    @Test
    fun `parses interactive response payload`() {
        var message: TranscriptBridgeMessage? = null
        val bridge = TranscriptBridge { message = it }

        bridge.postMessage(
            """
            {"type":"interactive_response","action":"askUserQuestionSubmit","questionId":"question-1","answers":{"scope":"session"}}
            """.trimIndent()
        )

        assertNotNull(message)
        assertEquals("interactive_response", message?.type)
        assertEquals("askUserQuestionSubmit", message?.action)
        assertEquals("question-1", message?.questionId)
        assertEquals("session", message?.raw?.getAsJsonObject("answers")?.get("scope")?.asString)
    }

    @Test
    fun `ignores invalid payload`() {
        var called = false
        val bridge = TranscriptBridge { called = true }

        bridge.postMessage("not json")

        assertEquals(false, called)
    }
}
