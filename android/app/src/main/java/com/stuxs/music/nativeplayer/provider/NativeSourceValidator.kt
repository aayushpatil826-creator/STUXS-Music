package com.stuxs.music.nativeplayer.provider

import com.stuxs.music.nativeplayer.model.NativeTrack

object NativeSourceValidator {

    data class ValidationResult(
        val isValid: Boolean,
        val reason: String? = null
    )

    fun validateTrackSource(track: NativeTrack): ValidationResult {
        // 1. Permanent block against SoundCloud
        if (track.provider.equals("soundcloud", ignoreCase = true) ||
            track.id.startsWith("soundcloud-", ignoreCase = true)
        ) {
            return ValidationResult(false, "SoundCloud provider is permanently removed")
        }

        // 2. Offline / Local file validation
        if (track.isDownloaded || track.isLocal) {
            val localPath = track.localFilePath
            if (!localPath.isNullOrBlank()) {
                val file = java.io.File(localPath)
                if (file.exists() && file.length() > 0) {
                    return ValidationResult(true)
                }
            }
            if (!track.audioUrl.isNullOrBlank() && track.audioUrl.startsWith("content://")) {
                return ValidationResult(true)
            }
        }

        // 3. Audio URL check
        val url = track.audioUrl?.trim()
        if (url.isNullOrBlank()) {
            return ValidationResult(false, "Track has no playable audio URL (metadata-only)")
        }

        // 4. Protocol validation
        if (!url.startsWith("http://", ignoreCase = true) &&
            !url.startsWith("https://", ignoreCase = true) &&
            !url.startsWith("file://", ignoreCase = true) &&
            !url.startsWith("content://", ignoreCase = true)
        ) {
            return ValidationResult(false, "Unsupported URL scheme: $url")
        }

        // 5. Explicit iTunes / Apple Preview rejection
        if (track.provider.equals("itunes", ignoreCase = true) ||
            url.contains("audio-ssl.itunes.apple.com", ignoreCase = true) ||
            url.contains("/preview.m4a", ignoreCase = true) ||
            url.contains("/preview.mp3", ignoreCase = true)
        ) {
            return ValidationResult(false, "Preview-only audio stream (~30s) cannot be played as full song")
        }

        // 6. Preview term in URL with short duration safeguard
        // Only reject if BOTH duration is short (<= 35s) AND the URL or title explicitly marks it as preview
        val isExplicitPreview = url.contains("preview", ignoreCase = true) ||
                track.title.contains("(preview)", ignoreCase = true) ||
                track.title.contains("[preview]", ignoreCase = true)

        if (isExplicitPreview && track.durationMs in 1..35000L) {
            return ValidationResult(false, "Explicit short preview sample (~${track.durationMs / 1000}s) rejected")
        }

        // Legitimate short track (e.g. short intro or interlude with real stream) is allowed
        return ValidationResult(true)
    }
}
