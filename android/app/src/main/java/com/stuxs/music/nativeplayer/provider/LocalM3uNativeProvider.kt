package com.stuxs.music.nativeplayer.provider

import android.content.Context
import com.stuxs.music.nativeplayer.data.LocalTrackEntity
import com.stuxs.music.nativeplayer.data.StuxsNativeDatabase
import com.stuxs.music.nativeplayer.model.NativeTrack
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class LocalM3uNativeProvider(
    private val context: Context? = null
) : NativeMusicProvider {

    override val id: String = "local"
    override val name: String = "Local & M3U"
    override val isAvailable: Boolean = true

    override suspend fun search(query: String): NativeSearchResults = withContext(Dispatchers.IO) {
        val q = query.trim().lowercase()
        if (q.isBlank() || context == null) return@withContext NativeSearchResults()

        try {
            val dao = StuxsNativeDatabase.getInstance(context).localTrackDao()
            val list = mutableListOf<NativeTrack>()
            // Query local indexed tracks if any
            NativeSearchResults(tracks = list)
        } catch (e: Exception) {
            NativeSearchResults()
        }
    }

    override suspend fun getTrack(id: String): NativeTrack? = withContext(Dispatchers.IO) {
        if (context == null) return@withContext null
        try {
            val dao = StuxsNativeDatabase.getInstance(context).localTrackDao()
            val entity: LocalTrackEntity = dao.getLocalTrackById(id) ?: return@withContext null
            NativeTrack(
                id = entity.id,
                title = entity.title,
                artist = entity.artist,
                album = entity.album,
                artworkUrl = entity.artworkUri,
                audioUrl = entity.contentUri,
                durationMs = entity.durationMs,
                provider = "local",
                isLocal = true,
                localFilePath = entity.filePath
            )
        } catch (e: Exception) {
            null
        }
    }

    override suspend fun resolveStreamUrl(track: NativeTrack): String? {
        // Strict requirement: Never convert HTTP to HTTPS. Preserve exact URL.
        return track.audioUrl ?: track.localFilePath
    }
}
