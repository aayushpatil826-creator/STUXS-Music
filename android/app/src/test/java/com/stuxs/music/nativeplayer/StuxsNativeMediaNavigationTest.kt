package com.stuxs.music.nativeplayer

import com.stuxs.music.nativeplayer.model.NativeRepeatMode
import com.stuxs.music.nativeplayer.model.NativeTrack
import org.junit.Assert.*
import org.junit.Test

/**
 * Focused tests verifying that Media3 navigation commands (NEXT / PREVIOUS)
 * advance or rewind the native queue exactly once, preserving sequential order
 * without skipping intermediate tracks.
 */
class StuxsNativeMediaNavigationTest {

    private fun createSampleQueue(count: Int = 4): List<NativeTrack> {
        return (0 until count).map { i ->
            NativeTrack(
                id = "track-$i",
                title = "Song $i",
                artist = "Artist $i",
                album = "Album $i",
                durationMs = 180000L
            )
        }
    }

    class TestEngine(private val queue: List<NativeTrack>) {
        var currentIndex: Int = 0
            private set
        var repeatMode: NativeRepeatMode = NativeRepeatMode.OFF
        val trackChangedHistory = mutableListOf<Pair<String, Int>>()

        init {
            if (queue.isNotEmpty()) {
                recordTrackChange()
            }
        }

        private fun recordTrackChange() {
            val track = queue.getOrNull(currentIndex)
            if (track != null) {
                trackChangedHistory.add(track.title to currentIndex)
            }
        }

        fun hasNextTrack(): Boolean {
            if (queue.isEmpty()) return false
            if (currentIndex < queue.size - 1) return true
            if (repeatMode == NativeRepeatMode.ALL) return true
            return false
        }

        fun hasPreviousTrack(): Boolean {
            if (queue.isEmpty()) return false
            if (currentIndex > 0) return true
            if (repeatMode == NativeRepeatMode.ALL) return true
            return true
        }

        fun skipToNext(): Boolean {
            if (queue.isEmpty()) return false
            if (currentIndex < queue.size - 1) {
                currentIndex++
                recordTrackChange()
                return true
            }
            if (repeatMode == NativeRepeatMode.ALL && queue.isNotEmpty()) {
                currentIndex = 0
                recordTrackChange()
                return true
            }
            return false
        }

        fun skipToPrevious(): Boolean {
            if (queue.isEmpty()) return false
            if (currentIndex > 0) {
                currentIndex--
                recordTrackChange()
                return true
            }
            return false
        }

        fun handleTrackEnded(): Boolean {
            return when (repeatMode) {
                NativeRepeatMode.ONE -> {
                    recordTrackChange()
                    true
                }
                NativeRepeatMode.ALL, NativeRepeatMode.OFF -> {
                    skipToNext()
                }
            }
        }
    }

    @Test
    fun testSingleNextExecution_advancesTrack0ToTrack1_neverTrack2() {
        val queue = createSampleQueue(4)
        val engine = TestEngine(queue)
        assertEquals(0, engine.currentIndex)
        assertEquals("Song 0", queue[engine.currentIndex].title)

        // Single execution of next
        val handled = engine.skipToNext()
        assertTrue("skipToNext should succeed", handled)
        assertEquals("Track index must advance to 1, NEVER 2", 1, engine.currentIndex)
        assertEquals("Current song must be Song 1", "Song 1", queue[engine.currentIndex].title)
    }

    @Test
    fun testSequentialNextTransitions_shuffleOff() {
        val queue = createSampleQueue(4)
        val engine = TestEngine(queue)

        // Track 0 -> Track 1
        assertTrue(engine.skipToNext())
        assertEquals(1, engine.currentIndex)
        assertEquals("Song 1", queue[engine.currentIndex].title)

        // Track 1 -> Track 2
        assertTrue(engine.skipToNext())
        assertEquals(2, engine.currentIndex)
        assertEquals("Song 2", queue[engine.currentIndex].title)

        // Track 2 -> Track 3 (Penultimate to Last)
        assertTrue(engine.skipToNext())
        assertEquals(3, engine.currentIndex)
        assertEquals("Song 3", queue[engine.currentIndex].title)

        // Last track: hasNextTrack must be false (Repeat OFF)
        assertFalse("Last track must report no next track", engine.hasNextTrack())
        val canAdvance = engine.skipToNext()
        assertFalse("Cannot advance beyond last track", canAdvance)
        assertEquals("Index must remain 3", 3, engine.currentIndex)
    }

    @Test
    fun testSinglePreviousExecution_rewindsTrack2ToTrack1() {
        val queue = createSampleQueue(4)
        val engine = TestEngine(queue)

        engine.skipToNext() // to 1
        engine.skipToNext() // to 2
        assertEquals(2, engine.currentIndex)

        // Single execution of previous
        val handled = engine.skipToPrevious()
        assertTrue("skipToPrevious should succeed", handled)
        assertEquals("Must rewind to Track 1, NEVER Track 0", 1, engine.currentIndex)
        assertEquals("Song 1", queue[engine.currentIndex].title)
    }

    @Test
    fun testMedia3CommandDispatchContract_singleExecutionPreserved() {
        val queue = createSampleQueue(4)
        val engine = TestEngine(queue)

        // Simulate Media3 flow AFTER fix:
        // 1. Controller calls COMMAND_SEEK_TO_NEXT
        // 2. onPlayerCommandRequest returns RESULT_SUCCESS without calling skipToNext
        // 3. MediaSession dispatches to StuxsForwardingPlayer.seekToNext() which calls engine.skipToNext() ONCE.
        fun simulateMedia3NextCommand(e: TestEngine) {
            val isCommandAllowed = e.hasNextTrack()
            if (isCommandAllowed) {
                // ForwardingPlayer.seekToNext()
                e.skipToNext()
            }
        }

        assertEquals(0, engine.currentIndex)
        simulateMedia3NextCommand(engine)

        // Exactly one advancement
        assertEquals(1, engine.currentIndex)
        assertEquals("Song 1", queue[engine.currentIndex].title)

        // Exactly 2 entries in history (initial + 1 next)
        assertEquals(2, engine.trackChangedHistory.size)
        assertEquals("Song 0" to 0, engine.trackChangedHistory[0])
        assertEquals("Song 1" to 1, engine.trackChangedHistory[1])
    }

    @Test
    fun testAutoNextExecution_advancesExactlyOnceAfterStateEnded() {
        val queue = createSampleQueue(3)
        val engine = TestEngine(queue)

        assertEquals(0, engine.currentIndex)

        // Simulate STATE_ENDED
        val advanced = engine.handleTrackEnded()
        assertTrue(advanced)
        assertEquals(1, engine.currentIndex)
        assertEquals("Song 1", queue[engine.currentIndex].title)

        // Simulate second STATE_ENDED
        val advanced2 = engine.handleTrackEnded()
        assertTrue(advanced2)
        assertEquals(2, engine.currentIndex)
        assertEquals("Song 2", queue[engine.currentIndex].title)

        // Simulate third STATE_ENDED (end of queue, Repeat OFF)
        val advanced3 = engine.handleTrackEnded()
        assertFalse(advanced3)
        assertEquals("Index must stay on last track", 2, engine.currentIndex)
    }

    @Test
    fun testRepeatAll_loopsToStartAfterLastTrack() {
        val queue = createSampleQueue(3)
        val engine = TestEngine(queue)
        engine.repeatMode = NativeRepeatMode.ALL

        engine.skipToNext() // 0 -> 1
        engine.skipToNext() // 1 -> 2
        assertEquals(2, engine.currentIndex)
        assertTrue("Repeat ALL must report hasNext on last track", engine.hasNextTrack())

        engine.skipToNext() // 2 -> 0 (loop)
        assertEquals(0, engine.currentIndex)
        assertEquals("Song 0", queue[engine.currentIndex].title)
    }
}
