package com.stuxs.music.nativeplayer.model

/**
 * Authoritative native track model used across ExoPlayer, MediaSession,
 * Room database, and offline download layers.
 */
data class NativeTrack @JvmOverloads constructor(
    val id: String,
    val title: String,
    val artist: String,
    val album: String? = null,
    val artworkUrl: String? = null,
    val audioUrl: String? = null,
    val durationMs: Long = 0L,
    val provider: String = "stuxs",
    val isLocal: Boolean = false,
    val isDownloaded: Boolean = false,
    val localFilePath: String? = null,
    val isM3U: Boolean = false,
    val lyricsLrc: String? = null
) {
    val isPlayable: Boolean
        get() = !localFilePath.isNullOrBlank() || !audioUrl.isNullOrBlank()
}

enum class StateType {
    IDLE,
    BUFFERING,
    READY,
    PLAYING,
    PAUSED,
    ENDED,
    ERROR
}

enum class NativeRepeatMode {
    OFF,
    ALL,
    ONE
}

data class NativePlaybackState(
    val state: StateType = StateType.IDLE,
    val currentTrack: NativeTrack? = null,
    val positionMs: Long = 0L,
    val durationMs: Long = 0L,
    val bufferedPositionMs: Long = 0L,
    val repeatMode: NativeRepeatMode = NativeRepeatMode.OFF,
    val shuffleEnabled: Boolean = false,
    val queue: List<NativeTrack> = emptyList(),
    val currentIndex: Int = -1,
    val errorMessage: String? = null
)
