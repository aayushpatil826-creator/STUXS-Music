package com.stuxs.music.nativeplayer

import com.stuxs.music.lyrics.LrcParser
import com.stuxs.music.lyrics.SyncedLyricLine
import com.stuxs.music.nativeplayer.model.NativeRepeatMode
import com.stuxs.music.nativeplayer.model.NativeTrack
import com.stuxs.music.nativeplayer.model.StateType
import com.stuxs.music.ui.viewmodel.NowPlayingTab
import com.stuxs.music.ui.viewmodel.PlayerUiState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class, FlowPreview::class)
class StuxsNativePhase4UiAndPlayerTest {

    // 1. LRC Parsing and Timestamp Extraction
    @Test
    fun testLrcParsing_standardFormat() {
        val sampleLrc = """
            [00:12.50] First line of lyrics
            [00:15.80] Second line of lyrics
            [01:05.10] Chorus starts here
        """.trimIndent()

        val parsed = LrcParser.parse(sampleLrc)
        assertEquals("Should parse exactly 3 lines", 3, parsed.size)
        assertEquals(12500L, parsed[0].timeMs)
        assertEquals("First line of lyrics", parsed[0].text)
        assertEquals(15800L, parsed[1].timeMs)
        assertEquals("Second line of lyrics", parsed[1].text)
        assertEquals(65100L, parsed[2].timeMs)
        assertEquals("Chorus starts here", parsed[2].text)
    }

    // 2. Lyrics Binary Search O(log N) Precision
    @Test
    fun testLyricsBinarySearch_findsExactAndSurroundingLines() {
        val lyrics = listOf(
            SyncedLyricLine(10000L, "Intro music"),
            SyncedLyricLine(20000L, "Verse 1 begins"),
            SyncedLyricLine(35000L, "Verse 1 continues"),
            SyncedLyricLine(50000L, "Chorus Anthem"),
            SyncedLyricLine(80000L, "Outro fades")
        )

        // Case A: Before the first line
        assertEquals(-1, LrcParser.findActiveLyricIndex(lyrics, 5000L))

        // Case B: Exactly on line 0
        assertEquals(0, LrcParser.findActiveLyricIndex(lyrics, 10000L))

        // Case C: Between line 0 and line 1
        assertEquals(0, LrcParser.findActiveLyricIndex(lyrics, 15000L))

        // Case D: Exactly on line 1
        assertEquals(1, LrcParser.findActiveLyricIndex(lyrics, 20000L))

        // Case E: Inside Chorus (between 50s and 80s)
        assertEquals(3, LrcParser.findActiveLyricIndex(lyrics, 65000L))

        // Case F: Past the last line
        assertEquals(4, LrcParser.findActiveLyricIndex(lyrics, 100000L))
    }

    // 3. Player UI State: Controlled Position Updates & Scrubbing
    @Test
    fun testPlayerUiState_scrubbingOverridesTicker() {
        val track = NativeTrack(
            id = "test-track",
            title = "Starboy",
            artist = "The Weeknd",
            audioUrl = "https://example.com/starboy.mp4",
            durationMs = 240000L
        )

        val initialState = PlayerUiState(
            currentTrack = track,
            isPlaying = true,
            positionMs = 30000L,
            durationMs = 240000L,
            progress = 30000f / 240000f
        )

        // Normal playing state
        assertEquals(30000L, initialState.positionMs)

        // User scrubs to 50% (120000ms)
        val scrubFraction = 0.5f
        val targetPos = (initialState.durationMs * scrubFraction).toLong()
        val scrubbedState = initialState.copy(
            positionMs = targetPos,
            progress = scrubFraction
        )

        assertEquals(120000L, scrubbedState.positionMs)
        assertEquals(0.5f, scrubbedState.progress, 0.001f)
    }

    // 4. Queue Synchronization & Advancing
    @Test
    fun testQueueSynchronization() {
        val track1 = NativeTrack(id = "1", title = "Track One", artist = "Artist A")
        val track2 = NativeTrack(id = "2", title = "Track Two", artist = "Artist B")
        val track3 = NativeTrack(id = "3", title = "Track Three", artist = "Artist C")
        val queue = listOf(track1, track2, track3)

        var uiState = PlayerUiState(
            currentTrack = track1,
            queue = queue,
            isPlaying = true
        )

        assertEquals("Track One", uiState.currentTrack?.title)
        assertEquals(3, uiState.queue.size)

        // Simulate Next Track progression
        val nextIndex = uiState.queue.indexOfFirst { it.id == uiState.currentTrack?.id } + 1
        if (nextIndex < uiState.queue.size) {
            uiState = uiState.copy(currentTrack = uiState.queue[nextIndex])
        }

        assertEquals("Track Two", uiState.currentTrack?.title)

        // Simulate Previous Track
        val prevIndex = uiState.queue.indexOfFirst { it.id == uiState.currentTrack?.id } - 1
        if (prevIndex >= 0) {
            uiState = uiState.copy(currentTrack = uiState.queue[prevIndex])
        }

        assertEquals("Track One", uiState.currentTrack?.title)
    }

    // 5. Repeat & Shuffle Mode Cycling
    @Test
    fun testRepeatModeCycling() {
        var repeatMode = NativeRepeatMode.OFF
        repeatMode = when (repeatMode) {
            NativeRepeatMode.OFF -> NativeRepeatMode.ALL
            NativeRepeatMode.ALL -> NativeRepeatMode.ONE
            NativeRepeatMode.ONE -> NativeRepeatMode.OFF
        }
        assertEquals(NativeRepeatMode.ALL, repeatMode)

        repeatMode = when (repeatMode) {
            NativeRepeatMode.OFF -> NativeRepeatMode.ALL
            NativeRepeatMode.ALL -> NativeRepeatMode.ONE
            NativeRepeatMode.ONE -> NativeRepeatMode.OFF
        }
        assertEquals(NativeRepeatMode.ONE, repeatMode)

        repeatMode = when (repeatMode) {
            NativeRepeatMode.OFF -> NativeRepeatMode.ALL
            NativeRepeatMode.ALL -> NativeRepeatMode.ONE
            NativeRepeatMode.ONE -> NativeRepeatMode.OFF
        }
        assertEquals(NativeRepeatMode.OFF, repeatMode)
    }

    // 6. Search Debounce (300ms) Flow Testing
    @Test
    fun testSearchDebounce_300msDelay() = runTest {
        val testDispatcher = StandardTestDispatcher(testScheduler)
        val queryFlow = MutableStateFlow("")
        val debouncedResults = mutableListOf<String>()

        val job = launch(testDispatcher) {
            queryFlow
                .debounce(300L)
                .collect { debouncedResults.add(it) }
        }

        // Rapid typing: "s", "sa", "sam", "samj" within 150ms
        queryFlow.value = "s"
        advanceTimeBy(50L)
        queryFlow.value = "sa"
        advanceTimeBy(50L)
        queryFlow.value = "sam"
        advanceTimeBy(50L)
        queryFlow.value = "samj"
        advanceTimeBy(100L)

        // At 250ms total, debounce threshold (300ms) not reached yet
        assertEquals("No debounce emission yet during rapid typing", 0, debouncedResults.size)

        // Advance past 300ms threshold
        advanceTimeBy(350L)

        // Only final query "samj" should be emitted
        assertEquals(1, debouncedResults.size)
        assertEquals("samj", debouncedResults[0])

        job.cancel()
    }

    // 7. Tab Switching: Artwork vs Lyrics
    @Test
    fun testNowPlayingTabToggle() {
        var state = PlayerUiState(activeTab = NowPlayingTab.ARTWORK)
        assertEquals(NowPlayingTab.ARTWORK, state.activeTab)

        state = state.copy(activeTab = NowPlayingTab.LYRICS)
        assertEquals(NowPlayingTab.LYRICS, state.activeTab)

        state = state.copy(activeTab = NowPlayingTab.ARTWORK)
        assertEquals(NowPlayingTab.ARTWORK, state.activeTab)
    }

    // 8. Modal & Queue Visibility State
    @Test
    fun testModalAndQueueVisibility() {
        var state = PlayerUiState(isNowPlayingOpen = false, isQueueOpen = false)
        assertFalse(state.isNowPlayingOpen)
        assertFalse(state.isQueueOpen)

        state = state.copy(isNowPlayingOpen = true)
        assertTrue(state.isNowPlayingOpen)

        state = state.copy(isQueueOpen = true)
        assertTrue(state.isQueueOpen)

        state = state.copy(isQueueOpen = false)
        assertFalse(state.isQueueOpen)
        assertTrue(state.isNowPlayingOpen)
    }
}
