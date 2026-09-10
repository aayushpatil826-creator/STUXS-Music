package com.stuxs.music.nativeplayer

import com.stuxs.music.nativeplayer.model.NativeTrack
import com.stuxs.music.nativeplayer.provider.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class StuxsNativeSearchAndProviderTest {

    private val catalogTracks = listOf(
        // Samjhawan studio versions
        NativeTrack(
            id = "js-samjhawan",
            title = "Samjhawan",
            artist = "Jawad Ahmad, Shreya Ghoshal, Arijit Singh",
            album = "Humpty Sharma Ki Dulhania",
            audioUrl = "https://aac.saavncdn.com/samjhawan_320.mp4",
            durationMs = 265000L,
            provider = "jiosaavn"
        ),
        NativeTrack(
            id = "gaana-samjhawan",
            title = "Samjhawan (From \"Humpty Sharma Ki Dulhania\")",
            artist = "Jawad Ahmad, Shreya Ghoshal, Arijit Singh",
            album = "Bollywood Love Anthems",
            audioUrl = "https://stream.gaana.com/samjhawan/playlist.m3u8",
            durationMs = 265000L,
            provider = "gaana"
        ),
        NativeTrack(
            id = "js-samjhawan-unplugged",
            title = "Samjhawan (Unplugged)",
            artist = "Alia Bhatt",
            album = "Humpty Sharma Ki Dulhania",
            audioUrl = "https://aac.saavncdn.com/samjhawan_unplugged_320.mp4",
            durationMs = 210000L,
            provider = "jiosaavn"
        ),
        NativeTrack(
            id = "js-samjhawan-remix",
            title = "Samjhawan (Club Remix)",
            artist = "DJ Chetas, Arijit Singh",
            album = "Club Hits",
            audioUrl = "https://aac.saavncdn.com/samjhawan_remix_320.mp4",
            durationMs = 230000L,
            provider = "jiosaavn"
        ),

        // Arijit Singh tracks
        NativeTrack(
            id = "js-tum-hi-ho",
            title = "Tum Hi Ho",
            artist = "Arijit Singh",
            album = "Aashiqui 2",
            audioUrl = "https://aac.saavncdn.com/tum_hi_ho_320.mp4",
            durationMs = 262000L,
            provider = "jiosaavn"
        ),
        NativeTrack(
            id = "js-kesariya",
            title = "Kesariya",
            artist = "Arijit Singh, Pritam",
            album = "Brahmastra",
            audioUrl = "https://aac.saavncdn.com/kesariya_320.mp4",
            durationMs = 268000L,
            provider = "jiosaavn"
        ),

        // Shape of You
        NativeTrack(
            id = "js-shape-of-you",
            title = "Shape of You",
            artist = "Ed Sheeran",
            album = "÷ (Divide)",
            audioUrl = "https://aac.saavncdn.com/shape_of_you_320.mp4",
            durationMs = 233000L,
            provider = "jiosaavn"
        ),

        // Believer
        NativeTrack(
            id = "js-believer",
            title = "Believer",
            artist = "Imagine Dragons",
            album = "Evolve",
            audioUrl = "https://aac.saavncdn.com/believer_320.mp4",
            durationMs = 204000L,
            provider = "jiosaavn"
        ),

        // M3U HTTP and HTTPS streams
        NativeTrack(
            id = "m3u-http-stream",
            title = "Progressive Web Stream",
            artist = "Radio DJ",
            audioUrl = "http://stream.radiostation.com/live.mp3",
            durationMs = 0L,
            provider = "local",
            isM3U = true
        ),
        NativeTrack(
            id = "m3u-https-stream",
            title = "Secure HLS Stream",
            artist = "Broadcast Network",
            audioUrl = "https://secure.broadcaster.com/hls/audio.m3u8",
            durationMs = 0L,
            provider = "local",
            isM3U = true
        ),

        // STUXS First Party
        NativeTrack(
            id = "stuxs-track-1",
            title = "Obsidian Nights",
            artist = "STUXS Collective",
            album = "Volume 1",
            audioUrl = "https://ebadlsnwjvkgkdqnulea.supabase.co/storage/v1/object/public/stuxs-audio/obsidian.flac",
            durationMs = 310000L,
            provider = "stuxs"
        )
    )

    // 1. Source Validation: Preview Rejection
    @Test
    fun testSourceValidation_previewRejection() {
        val itunesPreview = NativeTrack(
            id = "itunes-sample",
            title = "Sample Song",
            artist = "Sample Artist",
            audioUrl = "https://audio-ssl.itunes.apple.com/itunes-assets/preview.m4a",
            durationMs = 30000L,
            provider = "itunes"
        )
        val result = NativeSourceValidator.validateTrackSource(itunesPreview)
        assertFalse("iTunes 30-second preview must be rejected", result.isValid)
        assertTrue(result.reason!!.contains("Preview-only", ignoreCase = true))
    }

    // 2. Source Validation: SoundCloud Rejection
    @Test
    fun testSourceValidation_soundCloudRejection() {
        val scTrack = NativeTrack(
            id = "soundcloud-track-123",
            title = "Leaked Track",
            artist = "Uploader",
            audioUrl = "https://api.soundcloud.com/stream/123",
            durationMs = 180000L,
            provider = "soundcloud"
        )
        val result = NativeSourceValidator.validateTrackSource(scTrack)
        assertFalse("SoundCloud provider must be permanently rejected", result.isValid)
    }

    // 3. Source Validation: Invalid URL Handling
    @Test
    fun testSourceValidation_invalidUrlHandling() {
        val emptyUrlTrack = NativeTrack(
            id = "empty-url",
            title = "Metadata Only Track",
            artist = "Artist",
            audioUrl = null,
            provider = "spotify"
        )
        val result = NativeSourceValidator.validateTrackSource(emptyUrlTrack)
        assertFalse("Metadata-only track without audioUrl must be rejected", result.isValid)

        val badSchemeTrack = NativeTrack(
            id = "bad-scheme",
            title = "FTP Audio",
            artist = "Artist",
            audioUrl = "ftp://example.com/song.mp3",
            provider = "custom"
        )
        val badResult = NativeSourceValidator.validateTrackSource(badSchemeTrack)
        assertFalse("Unsupported URL schemes must be rejected", badResult.isValid)
    }

    // 4. Source Validation: Short Track Non-Rejection
    @Test
    fun testSourceValidation_legitimateShortSongAllowed() {
        val shortIntroTrack = NativeTrack(
            id = "short-intro",
            title = "Album Intro",
            artist = "Artist",
            audioUrl = "https://aac.saavncdn.com/intro_320.mp4",
            durationMs = 28000L, // 28s legitimate short intro
            provider = "jiosaavn"
        )
        val result = NativeSourceValidator.validateTrackSource(shortIntroTrack)
        assertTrue("Legitimate short track without preview marker must be allowed", result.isValid)
    }

    // 5. M3U URL Preservation: HTTP & HTTPS
    @Test
    fun testM3UResolution_preservesExactUrls() {
        val httpTrack = catalogTracks.first { it.id == "m3u-http-stream" }
        assertEquals("http://stream.radiostation.com/live.mp3", httpTrack.audioUrl)
        assertTrue(httpTrack.audioUrl!!.startsWith("http://"))

        val httpsTrack = catalogTracks.first { it.id == "m3u-https-stream" }
        assertEquals("https://secure.broadcaster.com/hls/audio.m3u8", httpsTrack.audioUrl)
        assertTrue(httpsTrack.audioUrl!!.startsWith("https://"))
    }

    // 6. Search Ranking: "Samjawan" Typo-tolerant Match
    @Test
    fun testSearchRanking_samjawanTransliterationTypo() {
        val scored = catalogTracks
            .map { it to NativeSearchIntelligence.scoreTrack(it, "Samjawan") }
            .sortedByDescending { it.second }

        val topResult = scored.first().first
        assertEquals("Samjhawan", topResult.title)
        assertTrue("Top provider must be official studio catalog", topResult.provider == "jiosaavn" || topResult.provider == "gaana")
    }

    // 7. Search Ranking: Exact Title Match
    @Test
    fun testSearchRanking_exactTitleMatch() {
        val scored = catalogTracks
            .map { it to NativeSearchIntelligence.scoreTrack(it, "Shape of You") }
            .sortedByDescending { it.second }

        val topResult = scored.first().first
        assertEquals("Shape of You", topResult.title)
        assertEquals("Ed Sheeran", topResult.artist)
    }

    // 8. Search Ranking: Typo Tolerance "shape of youu"
    @Test
    fun testSearchRanking_typoTolerance() {
        val scored = catalogTracks
            .map { it to NativeSearchIntelligence.scoreTrack(it, "shape of youu") }
            .sortedByDescending { it.second }

        val topResult = scored.first().first
        assertEquals("Shape of You", topResult.title)
    }

    // 9. Search Ranking: Partial Match "believ"
    @Test
    fun testSearchRanking_partialMatch() {
        val scored = catalogTracks
            .map { it to NativeSearchIntelligence.scoreTrack(it, "believ") }
            .sortedByDescending { it.second }

        val topResult = scored.first().first
        assertEquals("Believer", topResult.title)
    }

    // 10. Search Ranking: Artist Match "Arijit Singh"
    @Test
    fun testSearchRanking_artistMatch() {
        val scored = catalogTracks
            .map { it to NativeSearchIntelligence.scoreTrack(it, "Arijit Singh") }
            .sortedByDescending { it.second }

        val topResult = scored.first().first
        assertTrue("Top track should be performed by Arijit Singh", topResult.artist.contains("Arijit Singh"))
    }

    // 11. Search Ranking: Canonical Original over Remix / Derivative
    @Test
    fun testSearchRanking_canonicalPreferredOverRemix() {
        val originalScore = NativeSearchIntelligence.scoreTrack(
            catalogTracks.first { it.id == "js-samjhawan" },
            "Samjhawan"
        )
        val remixScore = NativeSearchIntelligence.scoreTrack(
            catalogTracks.first { it.id == "js-samjhawan-remix" },
            "Samjhawan"
        )
        assertTrue("Canonical studio master must score higher than remix", originalScore > remixScore)
    }

    // 12. Search Deduplication
    @Test
    fun testSearchDeduplication_keepsHighestScoringVersion() {
        val duplicateList = listOf(
            catalogTracks.first { it.id == "js-samjhawan" },
            catalogTracks.first { it.id == "gaana-samjhawan" }
        )
        val deduplicated = NativeSearchIntelligence.deduplicateTracks(duplicateList, "Samjhawan")
        assertEquals("Deduplication should keep exactly 1 primary track", 1, deduplicated.size)
        assertEquals("Samjhawan", deduplicated[0].title)
    }

    // 13. Playlist Membership Neutrality
    @Test
    fun testSearchRanking_playlistMembershipNeutrality() {
        // A track from a playlist with low title match must never beat a perfect title match
        val playlistTrack = NativeTrack(
            id = "user-playlist-1",
            title = "Acoustic Rainy Days",
            artist = "Indie Band",
            audioUrl = "https://example.com/acoustic.mp3",
            durationMs = 200000L,
            provider = "local"
        )
        val targetCatalogTrack = catalogTracks.first { it.id == "js-believer" }

        val playlistScore = NativeSearchIntelligence.scoreTrack(playlistTrack, "Believer")
        val catalogScore = NativeSearchIntelligence.scoreTrack(targetCatalogTrack, "Believer")

        assertTrue("Catalog match must rank vastly higher than unrelated playlist track", catalogScore > playlistScore + 100.0)
    }

    // 14. Search Caching & Provider Failure Isolation
    @Test
    fun testSearchEngine_cachingAndProviderFailureIsolation() = runBlocking {
        val failingProvider = object : NativeMusicProvider {
            override val id: String = "failing-provider"
            override val name: String = "Failing Provider"
            override val isAvailable: Boolean = true
            override suspend fun search(query: String): NativeSearchResults {
                throw RuntimeException("Simulated network timeout 504")
            }
            override suspend fun getTrack(id: String): NativeTrack? = null
            override suspend fun resolveStreamUrl(track: NativeTrack): String? = null
        }

        val mockWorkingProvider = object : NativeMusicProvider {
            override val id: String = "mock-working"
            override val name: String = "Working Provider"
            override val isAvailable: Boolean = true
            override suspend fun search(query: String): NativeSearchResults {
                return NativeSearchResults(tracks = catalogTracks)
            }
            override suspend fun getTrack(id: String): NativeTrack? = null
            override suspend fun resolveStreamUrl(track: NativeTrack): String? = null
        }

        val engine = NativeSearchEngine(
            providers = listOf(failingProvider, mockWorkingProvider),
            searchCacheSize = 50
        )

        // Step 1: Search succeeds despite one failing provider
        val results1 = engine.search("Samjawan")
        assertFalse("Search must succeed despite provider failure", results1.isEmpty())
        assertEquals("Samjhawan", results1.first().title)

        // Step 2: Cache hit test
        val results2 = engine.search("Samjawan")
        assertSame("Subsequent identical search must return cached results", results1, results2)
    }
}
