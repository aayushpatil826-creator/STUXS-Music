package com.stuxs.music.nativeplayer.provider

import com.stuxs.music.nativeplayer.model.NativeTrack
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class GaanaNativeProvider(
    private val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()
) : NativeMusicProvider {

    override val id: String = "gaana"
    override val name: String = "Gaana"
    override val isAvailable: Boolean = true

    private val primaryBaseUrl = "https://gaana-api-mumbai.stuxs.internal"
    private val publicMirrorUrl = "https://gaana.com"

    private fun cleanHtml(text: String?): String {
        if (text.isNullOrBlank()) return ""
        return text
            .replace("&quot;", "\"")
            .replace("&amp;", "&")
            .replace("&#039;", "'")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .trim()
    }

    private fun getHighResImage(imageUrl: String?): String {
        if (imageUrl.isNullOrBlank()) {
            return "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80"
        }
        return imageUrl
            .replace("150x150", "500x500")
            .replace("50x50", "500x500")
            .replace("175x175", "500x500")
    }

    override suspend fun search(query: String): NativeSearchResults = withContext(Dispatchers.IO) {
        val q = query.trim()
        if (q.isBlank()) return@withContext NativeSearchResults()

        try {
            val encodedQ = URLEncoder.encode(q, "UTF-8")
            val url = "$primaryBaseUrl/search?query=$encodedQ"
            val request = Request.Builder()
                .url(url)
                .addHeader("User-Agent", "STUXS-Music-Android/1.2.0")
                .build()

            val response = okHttpClient.newCall(request).execute()
            if (!response.isSuccessful) return@withContext NativeSearchResults()

            val body = response.body?.string() ?: return@withContext NativeSearchResults()
            val jsonObj = JSONObject(body)
            val tracksArray: JSONArray = jsonObj.optJSONArray("tracks") ?: jsonObj.optJSONArray("results") ?: return@withContext NativeSearchResults()

            val tracks = mutableListOf<NativeTrack>()
            val artists = mutableListOf<NativeArtist>()
            val albums = mutableListOf<NativeAlbum>()

            for (i in 0 until tracksArray.length()) {
                val item = tracksArray.optJSONObject(i) ?: continue
                val rawId = item.optString("track_id", item.optString("id", ""))
                if (rawId.isBlank()) continue

                val title = cleanHtml(item.optString("track_title", item.optString("title", "Unknown")))
                val artist = cleanHtml(item.optString("artist_name", item.optString("primary_artists", "Gaana Artist")))
                val album = cleanHtml(item.optString("album_title", item.optString("album", "")))
                val artwork = getHighResImage(item.optString("artwork", item.optString("image", "")))
                val durationSec = item.optLong("duration", 180L)
                val streamUrl = item.optString("stream_url", item.optString("hls_url", ""))

                val track = NativeTrack(
                    id = "gaana-$rawId",
                    title = title,
                    artist = artist,
                    album = if (album.isNotBlank()) album else null,
                    artworkUrl = artwork,
                    audioUrl = if (streamUrl.isNotBlank()) streamUrl else null,
                    durationMs = durationSec * 1000L,
                    provider = "gaana"
                )

                if (NativeSourceValidator.validateTrackSource(track).isValid) {
                    tracks.add(track)
                }
            }

            NativeSearchResults(tracks = tracks, artists = artists, albums = albums)
        } catch (e: Exception) {
            // Provider failure isolated safely
            NativeSearchResults()
        }
    }

    override suspend fun getTrack(id: String): NativeTrack? = withContext(Dispatchers.IO) {
        val cleanId = id.replace("gaana-", "")
        try {
            val url = "$primaryBaseUrl/track/$cleanId"
            val request = Request.Builder().url(url).build()
            val response = okHttpClient.newCall(request).execute()
            if (!response.isSuccessful) return@withContext null

            val body = response.body?.string() ?: return@withContext null
            val item = JSONObject(body)
            val title = cleanHtml(item.optString("track_title", item.optString("title", "Unknown")))
            val artist = cleanHtml(item.optString("artist_name", "Gaana Artist"))
            val album = cleanHtml(item.optString("album_title", ""))
            val streamUrl = item.optString("stream_url", item.optString("hls_url", ""))

            NativeTrack(
                id = "gaana-$cleanId",
                title = title,
                artist = artist,
                album = if (album.isNotBlank()) album else null,
                artworkUrl = getHighResImage(item.optString("artwork", "")),
                audioUrl = if (streamUrl.isNotBlank()) streamUrl else null,
                durationMs = item.optLong("duration", 180L) * 1000L,
                provider = "gaana"
            )
        } catch (e: Exception) {
            null
        }
    }

    override suspend fun resolveStreamUrl(track: NativeTrack): String? {
        return track.audioUrl
    }
}
