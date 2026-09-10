package com.stuxs.music.nativeplayer.provider

import com.stuxs.music.nativeplayer.model.NativeTrack
import kotlinx.coroutines.*
import java.util.Collections
import java.util.LinkedHashMap

class NativeSearchEngine(
    private val providers: List<NativeMusicProvider> = listOf(
        JioSaavnNativeProvider(),
        GaanaNativeProvider(),
        StuxsCatalogNativeProvider(),
        LocalM3uNativeProvider()
    ),
    private val searchCacheSize: Int = 100
) {
    // Thread-safe bounded LRU cache implemented via LinkedHashMap (pure JVM + Android compatible)
    private val cache: MutableMap<String, List<NativeTrack>> = Collections.synchronizedMap(
        object : LinkedHashMap<String, List<NativeTrack>>(searchCacheSize, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<NativeTrack>>?): Boolean {
                return size > searchCacheSize
            }
        }
    )

    suspend fun search(query: String): List<NativeTrack> = withContext(Dispatchers.Default) {
        val q = query.trim()
        if (q.isBlank()) return@withContext emptyList()

        // Check in-memory cache hit
        val cacheKey = q.lowercase()
        val cached = cache[cacheKey]
        if (cached != null) {
            return@withContext cached
        }

        // Execute parallel provider requests with error isolation
        val deferredList = providers.map { provider ->
            async(Dispatchers.IO) {
                try {
                    provider.search(q).tracks
                } catch (e: Exception) {
                    // Safe failure isolation: individual provider failure does not crash overall search
                    emptyList()
                }
            }
        }

        val allTracks = deferredList.awaitAll().flatten()

        // Filter valid sources only
        val validTracks = allTracks.filter { track ->
            NativeSourceValidator.validateTrackSource(track).isValid
        }

        // Deduplicate and rank by relevance score
        val rankedTracks = NativeSearchIntelligence.deduplicateTracks(validTracks, q)

        // Cache completed results
        cache[cacheKey] = rankedTracks

        rankedTracks
    }

    fun clearCache() {
        cache.clear()
    }
}
