package com.stuxs.music.nativeplayer.provider

import com.stuxs.music.nativeplayer.model.NativeTrack
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class StuxsCatalogNativeProvider(
    private val supabaseUrl: String = "https://ebadlsnwjvkgkdqnulea.supabase.co",
    private val supabaseAnonKey: String = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYWRsc253anZrZ2tkcW51bGVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDAzNTQxMTgsImV4cCI6MjA1NTkzMDExOH0.bV4lX5b7dC7K8t7t_kX2-jH5kX2-jH5kX2-jH5kX2-j",
    private val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()
) : NativeMusicProvider {

    override val id: String = "stuxs"
    override val name: String = "STUXS Catalog"
    override val isAvailable: Boolean = true

    override suspend fun search(query: String): NativeSearchResults = withContext(Dispatchers.IO) {
        val q = query.trim().replace(Regex("[,()]"), " ")
        if (q.isBlank()) return@withContext NativeSearchResults()

        try {
            val encodedQ = URLEncoder.encode("%$q%", "UTF-8")
            val orFilter = "title.ilike.$encodedQ,artist_name.ilike.$encodedQ,album_title.ilike.$encodedQ"
            val endpoint = "$supabaseUrl/rest/v1/songs?is_published=eq.true&audio_storage_path=not.is.null&or=($orFilter)&limit=30"

            val request = Request.Builder()
                .url(endpoint)
                .addHeader("apikey", supabaseAnonKey)
                .addHeader("Authorization", "Bearer $supabaseAnonKey")
                .addHeader("Accept", "application/json")
                .build()

            val response = okHttpClient.newCall(request).execute()
            if (!response.isSuccessful) return@withContext NativeSearchResults()

            val body = response.body?.string() ?: return@withContext NativeSearchResults()
            val jsonArray = JSONArray(body)
            val tracks = mutableListOf<NativeTrack>()
            val artists = mutableListOf<NativeArtist>()
            val albums = mutableListOf<NativeAlbum>()

            for (i in 0 until jsonArray.length()) {
                val row = jsonArray.optJSONObject(i) ?: continue
                val id = row.optString("id", "")
                val title = row.optString("title", "Unknown STUXS Track")
                val artist = row.optString("artist_name", "STUXS Artist")
                val album = row.optString("album_title", "")
                val audioPath = row.optString("audio_storage_path", "")
                val artworkUrl = row.optString("artwork_url", "")
                val durationSec = row.optLong("duration", 180L)

                val audioUrl = if (audioPath.isNotBlank()) {
                    "$supabaseUrl/storage/v1/object/public/stuxs-audio/$audioPath"
                } else null

                val track = NativeTrack(
                    id = "stuxs-$id",
                    title = title,
                    artist = artist,
                    album = if (album.isNotBlank()) album else null,
                    artworkUrl = if (artworkUrl.isNotBlank()) artworkUrl else null,
                    audioUrl = audioUrl,
                    durationMs = durationSec * 1000L,
                    provider = "stuxs"
                )

                if (NativeSourceValidator.validateTrackSource(track).isValid) {
                    tracks.add(track)
                }
            }

            NativeSearchResults(tracks = tracks, artists = artists, albums = albums)
        } catch (e: Exception) {
            NativeSearchResults()
        }
    }

    override suspend fun getTrack(id: String): NativeTrack? = withContext(Dispatchers.IO) {
        val cleanId = id.replace("stuxs-", "")
        try {
            val endpoint = "$supabaseUrl/rest/v1/songs?id=eq.$cleanId&limit=1"
            val request = Request.Builder()
                .url(endpoint)
                .addHeader("apikey", supabaseAnonKey)
                .addHeader("Authorization", "Bearer $supabaseAnonKey")
                .build()

            val response = okHttpClient.newCall(request).execute()
            if (!response.isSuccessful) return@withContext null

            val body = response.body?.string() ?: return@withContext null
            val array = JSONArray(body)
            if (array.length() == 0) return@withContext null

            val row = array.getJSONObject(0)
            val audioPath = row.optString("audio_storage_path", "")
            val audioUrl = if (audioPath.isNotBlank()) {
                "$supabaseUrl/storage/v1/object/public/stuxs-audio/$audioPath"
            } else null

            val albumStr = row.optString("album_title", "")
            val artworkStr = row.optString("artwork_url", "")

            NativeTrack(
                id = "stuxs-$cleanId",
                title = row.optString("title", "Unknown STUXS Track"),
                artist = row.optString("artist_name", "STUXS Artist"),
                album = if (albumStr.isNotBlank()) albumStr else null,
                artworkUrl = if (artworkStr.isNotBlank()) artworkStr else null,
                audioUrl = audioUrl,
                durationMs = row.optLong("duration", 180L) * 1000L,
                provider = "stuxs"
            )
        } catch (e: Exception) {
            null
        }
    }

    override suspend fun resolveStreamUrl(track: NativeTrack): String? {
        return track.audioUrl
    }
}
