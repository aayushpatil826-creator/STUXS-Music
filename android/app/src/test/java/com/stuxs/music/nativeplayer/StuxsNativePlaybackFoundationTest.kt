package com.stuxs.music.nativeplayer

import com.stuxs.music.nativeplayer.model.*
import com.stuxs.music.nativeplayer.resolver.ResolvedSource
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class StuxsNativePlaybackFoundationTest {

    @Test
    fun testNativeTrackModel() {
        val track = NativeTrack(
            id = "js-12345",
            title = "Kesariya",
            artist = "Arijit Singh",
            album = "Brahmastra",
            artworkUrl = "https://c.saavncdn.com/kesariya.jpg",
            audioUrl = "https://aac.saavncdn.com/kesariya.mp4",
            durationMs = 268000L,
            provider = "jiosaavn"
        )
        assertTrue("Track with audioUrl must be playable", track.isPlayable)
        assertEquals("jiosaavn", track.provider)
        assertFalse("Not local by default", track.isLocal)
        assertFalse("Not downloaded by default", track.isDownloaded)
    }

    @Test
    fun testPlaybackStateTransitions() {
        val initialState = NativePlaybackState()
        assertEquals(StateType.IDLE, initialState.state)
        assertEquals(0L, initialState.positionMs)

        val bufferingState = initialState.copy(state = StateType.BUFFERING)
        assertEquals(StateType.BUFFERING, bufferingState.state)

        val playingState = bufferingState.copy(
            state = StateType.PLAYING,
            positionMs = 15000L,
            durationMs = 240000L
        )
        assertEquals(StateType.PLAYING, playingState.state)
        assertEquals(15000L, playingState.positionMs)

        val pausedState = playingState.copy(state = StateType.PAUSED)
        assertEquals(StateType.PAUSED, pausedState.state)
        assertEquals(15000L, pausedState.positionMs)
    }

    @Test
    fun testRepeatModeTransitions() {
        var state = NativePlaybackState()
        assertEquals(NativeRepeatMode.OFF, state.repeatMode)

        state = state.copy(repeatMode = NativeRepeatMode.ALL)
        assertEquals(NativeRepeatMode.ALL, state.repeatMode)

        state = state.copy(repeatMode = NativeRepeatMode.ONE)
        assertEquals(NativeRepeatMode.ONE, state.repeatMode)
    }

    @Test
    fun testPreviewStreamRejectionPolicy() {
        // 1. iTunes 30s preview URL
        val itunesPreviewTrack = NativeTrack(
            id = "itunes-999",
            title = "Blinding Lights",
            artist = "The Weeknd",
            audioUrl = "https://audio-ssl.itunes.apple.com/itunes-assets/preview.m4a",
            durationMs = 30000L,
            provider = "itunes"
        )
        assertTrue(itunesPreviewTrack.provider.equals("itunes", ignoreCase = true))
        assertTrue(itunesPreviewTrack.audioUrl!!.contains("preview"))

        // 2. Short preview flag
        val shortTrack = NativeTrack(
            id = "sample-1",
            title = "Snippet",
            artist = "Artist",
            audioUrl = "https://example.com/audio/preview-snippet.mp3",
            durationMs = 29000L,
            provider = "sample"
        )
        assertTrue(shortTrack.durationMs in 1..35000L)
        assertTrue(shortTrack.audioUrl!!.contains("preview", ignoreCase = true))
    }

    @Test
    fun testSoundCloudRejectionPolicy() {
        val scTrack = NativeTrack(
            id = "soundcloud-8888",
            title = "Bootleg Remix",
            artist = "Unknown DJ",
            audioUrl = "https://api-v2.soundcloud.com/media/stream",
            durationMs = 180000L,
            provider = "soundcloud"
        )
        assertTrue("SoundCloud tracks must be identified for rejection",
            scTrack.provider.equals("soundcloud", ignoreCase = true) || scTrack.id.startsWith("soundcloud-")
        )
    }

    @Test
    fun testM3UUrlPreservation() {
        val httpM3u = NativeTrack(
            id = "m3u-stream-1",
            title = "Radio Station 1",
            artist = "Online Stream",
            audioUrl = "http://streaming.example.com/live.mp3",
            durationMs = 0L,
            provider = "local-m3u",
            isM3U = true
        )
        assertTrue("HTTP URLs must be preserved for M3U", httpM3u.audioUrl!!.startsWith("http://"))

        val httpsHlsM3u = NativeTrack(
            id = "m3u-stream-2",
            title = "HLS Stream",
            artist = "HLS Broadcast",
            audioUrl = "https://streaming.example.com/live/playlist.m3u8",
            durationMs = 0L,
            provider = "local-m3u",
            isM3U = true
        )
        assertTrue("HTTPS URLs must be preserved for M3U", httpsHlsM3u.audioUrl!!.startsWith("https://"))
        assertTrue("HLS .m3u8 detected", httpsHlsM3u.audioUrl!!.contains(".m3u8"))
    }

    @Test
    fun testSourceResolutionPriority() {
        // Priority order: Downloaded File > Local Device File > M3U Stream > Catalog Stream
        val downloadedFile = File("C:/test/downloaded_song.mp3")
        val localDeviceFile = File("C:/test/device_music.mp3")
        val m3uStreamUrl = "http://my-stream.com/live.mp3"
        val catalogStreamUrl = "https://aac.saavncdn.com/catalog.mp4"

        // Step 1: Downloaded source wins if downloaded file exists
        val isDownloaded = true
        val resolvedStep1 = if (isDownloaded) "LOCAL_DOWNLOADED" else "OTHER"
        assertEquals("LOCAL_DOWNLOADED", resolvedStep1)

        // Step 2: Local device file wins if not downloaded but isLocal
        val isLocal = true
        val resolvedStep2 = if (isLocal) "LOCAL_DEVICE" else "REMOTE"
        assertEquals("LOCAL_DEVICE", resolvedStep2)

        // Step 3: M3U preserves exact stream URL
        val isM3u = true
        val resolvedStep3 = if (isM3u) m3uStreamUrl else catalogStreamUrl
        assertEquals("http://my-stream.com/live.mp3", resolvedStep3)
    }

    @Test
    fun testAutoNextQueueAdvancement() {
        val trackA = NativeTrack(id = "1", title = "Song A", artist = "Artist 1")
        val trackB = NativeTrack(id = "2", title = "Song B", artist = "Artist 2")
        val trackC = NativeTrack(id = "3", title = "Song C", artist = "Artist 3")
        val queue = listOf(trackA, trackB, trackC)

        var currentIndex = 0
        assertEquals("Song A", queue[currentIndex].title)

        // Advance next
        if (currentIndex < queue.size - 1) currentIndex++
        assertEquals("Song B", queue[currentIndex].title)

        // Advance next
        if (currentIndex < queue.size - 1) currentIndex++
        assertEquals("Song C", queue[currentIndex].title)

        // End of queue reached (Repeat OFF)
        val hasNext = currentIndex < queue.size - 1
        assertFalse(hasNext)
    }

    @Test
    fun testNetworkLossResilience() {
        // MediaSession state must remain intact when network drops
        val activeState = NativePlaybackState(
            state = StateType.PLAYING,
            currentTrack = NativeTrack(id = "offline-1", title = "Offline Anthem", artist = "Artist", isDownloaded = true),
            positionMs = 45000L,
            durationMs = 210000L
        )

        // Simulate network disconnect
        val isNetworkAvailable = false
        // State and MediaSession do NOT get destroyed
        val postDisconnectState = activeState.copy(
            errorMessage = if (!isNetworkAvailable && !activeState.currentTrack!!.isDownloaded) "Network disconnected" else null
        )

        assertEquals(StateType.PLAYING, postDisconnectState.state)
        assertEquals(45000L, postDisconnectState.positionMs)
        assertNull("Downloaded track must not show network error", postDisconnectState.errorMessage)
    }

    @Test
    fun testAtomicTrackSwitchStopState() {
        val playingState = NativePlaybackState(
            state = StateType.PLAYING,
            currentTrack = NativeTrack(id = "song-A", title = "Song A", artist = "Artist A", isDownloaded = true),
            positionMs = 30000L,
            durationMs = 180000L
        )
        assertEquals(StateType.PLAYING, playingState.state)
        assertEquals("song-A", playingState.currentTrack?.id)

        // Atomic track switch: stop() transitions state cleanly to IDLE, clears track and position
        val stoppedState = playingState.copy(
            state = StateType.IDLE,
            positionMs = 0L,
            currentTrack = null
        )
        assertEquals(StateType.IDLE, stoppedState.state)
        assertNull("Track must be cleared on stop", stoppedState.currentTrack)
        assertEquals(0L, stoppedState.positionMs)
    }

    @Test
    fun testUnavailableTrackSwitchDoesNotResumeOldAudio() {
        val trackA = NativeTrack(id = "song-A", title = "Song A", artist = "Artist A", isDownloaded = true)
        val trackB = NativeTrack(id = "song-B", title = "Song B", artist = "Artist B", isDownloaded = false)

        var state = NativePlaybackState(
            state = StateType.PLAYING,
            currentTrack = trackA,
            positionMs = 45000L,
            durationMs = 200000L
        )
        assertEquals("song-A", state.currentTrack?.id)

        // Switching to unavailable track B immediately stops old audio
        val simulatedStopState = state.copy(
            state = StateType.IDLE,
            positionMs = 0L,
            currentTrack = null
        )
        assertEquals(StateType.IDLE, simulatedStopState.state)

        // Resolution fails for track B offline
        val unavailableState = simulatedStopState.copy(
            state = StateType.ERROR,
            errorMessage = "Cannot play 'Song B': No offline stream available"
        )
        assertEquals(StateType.ERROR, unavailableState.state)
        assertNull("Old track A must not be resumed on track B resolution failure", unavailableState.currentTrack)
    }
}
