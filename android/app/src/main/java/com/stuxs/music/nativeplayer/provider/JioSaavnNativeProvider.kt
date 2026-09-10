package com.stuxs.music.nativeplayer.provider

import android.util.Base64
import com.stuxs.music.nativeplayer.model.NativeTrack
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.spec.SecretKeySpec

class JioSaavnNativeProvider(
    private val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()
) : NativeMusicProvider {

    override val id: String = "jiosaavn"
    override val name: String = "JioSaavn"
    override val isAvailable: Boolean = true

    private val baseUrl: String = "https://www.jiosaavn.com/api.php"
    private val desKey = "38346591".toByteArray(Charsets.UTF_8)

    private fun decryptMediaUrl(encryptedUrl: String?): String? {
        if (encryptedUrl.isNullOrBlank()) return null
        return try {
            val keySpec = SecretKeySpec(desKey, "DES")
            val cipher = Cipher.getInstance("DES/ECB/PKCS5Padding")
            cipher.init(Cipher.DECRYPT_MODE, keySpec)
            val decodedBytes = Base64.decode(encryptedUrl.trim(), Base64.DEFAULT)
            val decryptedBytes = cipher.doFinal(decodedBytes)
            val decryptedStr = String(decryptedBytes, Charsets.UTF_8).trim()
            if (decryptedStr.startsWith("http")) decryptedStr else null
        } catch (e: Exception) {
            null
        }
    }

    private fun resolveHighQualityUrl(rawDecryptedUrl: String?): String? {
        if (rawDecryptedUrl.isNullOrBlank()) return null
        var url = rawDecryptedUrl
        if (url.contains(".mp4")) {
            url = url.replace(Regex("_(96|160|320|48)\\.mp4$"), "").replace(Regex("\\.mp4$"), "") + "_320.mp4"
        }
        if (url.startsWith("http://")) {
            url = url.replace("http://", "https://")
        }
        return url
    }

    private fun getHighResImage(imageUrl: String?): String {
        if (imageUrl.isNullOrBlank()) {
            return "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80"
        }
        return imageUrl.replace("150x150", "500x500").replace("50x50", "500x500")
    }

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

    override suspend fun search(query: String): NativeSearchResults = withContext(Dispatchers.IO) {
        val q = query.trim()
        if (q.isBlank()) return@withContext NativeSearchResults()

        try {
            val encodedQ = URLEncoder.encode(q, "UTF-8")
            val searchUrl = "$baseUrl?__call=search.getResults&_format=json&_marker=0&cc=in&p=1&n=20&q=$encodedQ"

            val request = Request.Builder()
                .url(searchUrl)
                .addHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                .build()

            val response = okHttpClient.newCall(request).execute()
            if (!response.isSuccessful) return@withContext NativeSearchResults()

            val bodyStr = response.body?.string() ?: return@withContext NativeSearchResults()
            val jsonObj = JSONObject(bodyStr)
            val resultsArray: JSONArray = jsonObj.optJSONArray("results") ?: return@withContext NativeSearchResults()

            val tracks = mutableListOf<NativeTrack>()
            val artists = mutableListOf<NativeArtist>()
            val albums = mutableListOf<NativeAlbum>()
            val seenArtists = mutableSetOf<String>()
            val seenAlbums = mutableSetOf<String>()

            for (i in 0 until resultsArray.length()) {
                val item = resultsArray.optJSONObject(i) ?: continue
                val rawId = item.optString("id", "")
                if (rawId.isBlank()) continue

                val moreInfo = item.optJSONObject("more_info") ?: JSONObject()
                val encryptedUrl = moreInfo.optString("encrypted_media_url", item.optString("encrypted_media_url", ""))
                val decrypted = decryptMediaUrl(encryptedUrl)
                val audioUrl = resolveHighQualityUrl(decrypted)

                val rawTitle = item.optString("song", item.optString("title", "Unknown"))
                val title = cleanHtml(rawTitle)

                var artistName = item.optString("primary_artists", "")
                if (artistName.isBlank()) {
                    val subtitle = item.optString("subtitle", "")
                    if (subtitle.contains("-")) {
                        artistName = subtitle.split("-")[0].trim()
                    }
                }
                artistName = cleanHtml(artistName)

                val albumName = cleanHtml(item.optString("album", moreInfo.optString("album", "")))
                val albumId = moreInfo.optString("album_id", item.optString("albumid", ""))
                val image = getHighResImage(item.optString("image", ""))
                val durationSec = item.optLong("duration", 0L)

                val track = NativeTrack(
                    id = "jiosaavn-$rawId",
                    title = title,
                    artist = if (artistName.isNotBlank()) artistName else "JioSaavn Artist",
                    album = if (albumName.isNotBlank()) albumName else null,
                    artworkUrl = image,
                    audioUrl = audioUrl,
                    durationMs = durationSec * 1000L,
                    provider = "jiosaavn"
                )

                // Validate track has playable audio source
                if (NativeSourceValidator.validateTrackSource(track).isValid) {
                    tracks.add(track)
                }

                if (artistName.isNotBlank() && seenArtists.add(artistName)) {
                    artists.add(
                        NativeArtist(
                            id = "jiosaavn-artist-${URLEncoder.encode(artistName, "UTF-8")}",
                            name = artistName,
                            artworkUrl = image
                        )
                    )
                }

                if (albumName.isNotBlank() && seenAlbums.add(albumName)) {
                    albums.add(
                        NativeAlbum(
                            id = "jiosaavn-album-${if (albumId.isNotBlank()) albumId else URLEncoder.encode(albumName, "UTF-8")}",
                            title = albumName,
                            artistName = artistName,
                            artworkUrl = image
                        )
                    )
                }
            }

            NativeSearchResults(
                tracks = tracks,
                artists = artists,
                albums = albums,
                playlists = emptyList()
            )
        } catch (e: Exception) {
            // Isolate provider failure
            NativeSearchResults()
        }
    }

    override suspend fun getTrack(id: String): NativeTrack? = withContext(Dispatchers.IO) {
        val cleanId = id.replace("jiosaavn-", "").replace("jiosaavn-track-", "")
        try {
            val url = "$baseUrl?__call=song.getDetails&cc=in&_marker=0&_format=json&pids=$cleanId"
            val request = Request.Builder().url(url).build()
            val response = okHttpClient.newCall(request).execute()
            if (!response.isSuccessful) return@withContext null

            val body = response.body?.string() ?: return@withContext null
            val json = JSONObject(body)
            val song = json.optJSONObject(cleanId) ?: return@withContext null

            val moreInfo = song.optJSONObject("more_info") ?: JSONObject()
            val encryptedUrl = moreInfo.optString("encrypted_media_url", song.optString("encrypted_media_url", ""))
            val audioUrl = resolveHighQualityUrl(decryptMediaUrl(encryptedUrl))

            NativeTrack(
                id = "jiosaavn-$cleanId",
                title = cleanHtml(song.optString("song", song.optString("title", ""))),
                artist = cleanHtml(song.optString("primary_artists", "")),
                album = cleanHtml(song.optString("album", "")),
                artworkUrl = getHighResImage(song.optString("image", "")),
                audioUrl = audioUrl,
                durationMs = song.optLong("duration", 0L) * 1000L,
                provider = "jiosaavn"
            )
        } catch (e: Exception) {
            null
        }
    }

    override suspend fun resolveStreamUrl(track: NativeTrack): String? {
        return track.audioUrl
    }
}
