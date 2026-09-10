package com.stuxs.music.nativeplayer.resolver

import android.content.Context
import com.stuxs.music.nativeplayer.data.repository.NativeDownloadRepository
import com.stuxs.music.nativeplayer.model.NativeTrack
import java.io.File

sealed class ResolvedSource {
    data class LocalFile(val file: File, val track: NativeTrack) : ResolvedSource()
    data class DeviceUri(val uriString: String, val track: NativeTrack) : ResolvedSource()
    data class RemoteStream(val url: String, val isHls: Boolean, val track: NativeTrack) : ResolvedSource()
    data class Unavailable(val reason: String, val track: NativeTrack) : ResolvedSource()
}

class NativeSourceResolver(private val context: Context) {
    private val downloadRepo = NativeDownloadRepository(context)

    /**
     * Resolves playable audio source following exact priority:
     * 1. Downloaded local file in native storage
     * 2. Local device audio file
     * 3. Valid M3U HTTP/HTTPS stream (URLs strictly preserved)
     * 4. Verified full-length catalog stream (JioSaavn, Gaana, STUXS)
     * 5. Unavailable (Rejects previews and unplayable tracks)
     */
    suspend fun resolveSource(track: NativeTrack): ResolvedSource {
        // Guard 1: Zero SoundCloud reintroduction
        if (track.provider.equals("soundcloud", ignoreCase = true) || track.id.startsWith("soundcloud-")) {
            return ResolvedSource.Unavailable("SoundCloud provider is permanently removed", track)
        }

        // Priority 1: Verified downloaded local file
        val downloadedFile = downloadRepo.getDownloadedFile(track.id)
        if (downloadedFile != null && downloadedFile.exists() && downloadedFile.length() >= 10240L) {
            val updatedTrack = track.copy(
                isDownloaded = true,
                localFilePath = downloadedFile.absolutePath
            )
            return ResolvedSource.LocalFile(downloadedFile, updatedTrack)
        }

        // Priority 2: Local device file / path / content URI
        val candidates = listOfNotNull(track.localFilePath, track.audioUrl)
            .filter { it.isNotBlank() }

        for (candidate in candidates) {
            if (candidate.startsWith("content://")) {
                return ResolvedSource.DeviceUri(candidate, track)
            }

            val cleanPath = when {
                candidate.startsWith("file://") -> {
                    try {
                        android.net.Uri.parse(candidate).path ?: candidate.removePrefix("file://")
                    } catch (_: Exception) {
                        candidate.removePrefix("file://")
                    }
                }
                candidate.startsWith("/") || candidate.matches(Regex("^[a-zA-Z]:[/\\\\].*")) -> candidate
                else -> null
            }

            if (cleanPath != null) {
                val localFile = File(cleanPath)
                if (localFile.exists() && localFile.length() > 0) {
                    return ResolvedSource.LocalFile(localFile, track)
                }
            }
        }

        // Priority 3: Valid M3U HTTP / HTTPS progressive or HLS stream
        if (track.isM3U || track.id.startsWith("m3u-") || track.provider.equals("local-m3u", ignoreCase = true)) {
            val streamUrl = track.audioUrl
            if (!streamUrl.isNullOrBlank() && (streamUrl.startsWith("http://") || streamUrl.startsWith("https://"))) {
                val isHls = streamUrl.contains(".m3u8") || streamUrl.contains("format=m3u8")
                return ResolvedSource.RemoteStream(streamUrl, isHls, track)
            }
        }

        // Guard 2: Reject 30-second preview streams (e.g. iTunes preview)
        val candidateUrl = track.audioUrl
        if (candidateUrl.isNullOrBlank()) {
            return ResolvedSource.Unavailable("No audio URL or local file available", track)
        }
        if (track.provider.equals("itunes", ignoreCase = true) || candidateUrl.contains("audio-ssl.itunes.apple.com")) {
            return ResolvedSource.Unavailable("Preview-only stream (~30s) cannot be played as full audio", track)
        }
        if (track.durationMs in 1..35000L && candidateUrl.contains("preview", ignoreCase = true)) {
            return ResolvedSource.Unavailable("Preview stream rejected by full-length policy", track)
        }

        // Priority 4: Verified full-length catalog stream (JioSaavn, Gaana, STUXS Core)
        if (candidateUrl.startsWith("http://") || candidateUrl.startsWith("https://")) {
            val isHls = candidateUrl.contains(".m3u8") || candidateUrl.contains("format=m3u8")
            return ResolvedSource.RemoteStream(candidateUrl, isHls, track)
        }

        return ResolvedSource.Unavailable("Unsupported audio stream protocol or missing source", track)
    }
}
