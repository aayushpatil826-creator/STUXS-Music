package com.stuxs.music.nativeplayer.engine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import com.stuxs.music.nativeplayer.model.NativePlaybackState
import com.stuxs.music.nativeplayer.model.NativeRepeatMode
import com.stuxs.music.nativeplayer.model.NativeTrack
import com.stuxs.music.nativeplayer.model.StateType
import com.stuxs.music.nativeplayer.resolver.NativeSourceResolver
import com.stuxs.music.nativeplayer.resolver.ResolvedSource
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.OkHttpClient
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.TimeUnit

@OptIn(UnstableApi::class)
class StuxsExoPlayerEngine(
    private val context: Context,
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
) {
    private val sourceResolver = NativeSourceResolver(context)

    private val okHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    private val httpDataSourceFactory = OkHttpDataSource.Factory(okHttpClient)
        .setUserAgent("STUXS-Music-ExoPlayer/1.2.0 (Android Native)")

    private val defaultDataSourceFactory = DefaultDataSource.Factory(context, httpDataSourceFactory)

    val exoPlayer: ExoPlayer = ExoPlayer.Builder(context)
        .setMediaSourceFactory(DefaultMediaSourceFactory(defaultDataSourceFactory))
        .build().apply {
            val audioAttributes = AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build()
            // Let ExoPlayer handle AudioFocus gracefully during native playback
            setAudioAttributes(audioAttributes, true)
            setHandleAudioBecomingNoisy(true)
        }

    private val _playbackState = MutableStateFlow(NativePlaybackState())
    val playbackState: StateFlow<NativePlaybackState> = _playbackState.asStateFlow()

    private var currentQueue: MutableList<NativeTrack> = mutableListOf()
    private var currentIndex: Int = -1
    private var progressJob: Job? = null
    private var prepareJob: Job? = null
    private var preloadJob: Job? = null

    private var isRecoveringFromError = false
    private var consecutiveErrorCount = 0
    private val maxErrorRecoveryRetries = 2

    // Tracks whether stop() was called intentionally so we don't auto-recover from intended stops.
    private var intentionallyStopped = false
    // Guards against multiple rapid idle-recovery triggers (single-flight).
    private var idleRecoveryJob: Job? = null

    private val commandInvalidationListeners = java.util.concurrent.CopyOnWriteArrayList<() -> Unit>()

    fun addCommandInvalidationListener(listener: () -> Unit) {
        commandInvalidationListeners.add(listener)
    }

    fun removeCommandInvalidationListener(listener: () -> Unit) {
        commandInvalidationListeners.remove(listener)
    }

    fun invalidateCommands() {
        for (listener in commandInvalidationListeners) {
            try {
                listener.invoke()
            } catch (t: Throwable) {
                android.util.Log.w("STUXS_SENTINEL", "[INVALIDATE_COMMANDS_ERR]", t)
            }
        }
    }

    var onTrackChangedListener: ((NativeTrack, Int) -> Unit)? = null
    var onPlaybackEndedListener: (() -> Unit)? = null
    var onPlaybackStateChangedListener: ((StateType) -> Unit)? = null
    var onPlayerErrorListener: ((PlaybackException) -> Unit)? = null

    init {
        android.util.Log.i("STUXS_SENTINEL", "[ENGINE_CREATE instance=" + hashCode() + "]")
        exoPlayer.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                android.util.Log.i("STUXS_SENTINEL", "[EXO_STATE_CHANGED state=" + state + " playWhenReady=" + exoPlayer.playWhenReady + "]")
                if (state == Player.STATE_READY) {
                    consecutiveErrorCount = 0
                    isRecoveringFromError = false
                    intentionallyStopped = false
                    idleRecoveryJob?.cancel()
                    idleRecoveryJob = null
                }
                if (state == Player.STATE_ENDED) {
                    handleTrackEnded()
                } else {
                    updateStateFromPlayer()

                    // Auto-recover when ExoPlayer drops to IDLE unexpectedly while we intended
                    // to be playing (playWhenReady=true, not an intentional stop, valid track).
                    // This handles OEM audio-stall events (e.g. OnePlus AudioTrack timestamp correction).
                    if (state == Player.STATE_IDLE
                        && exoPlayer.playWhenReady
                        && !intentionallyStopped
                        && idleRecoveryJob == null
                        && currentIndex in currentQueue.indices
                        && exoPlayer.playerError == null
                    ) {
                        val recoveryTrack = currentQueue.getOrNull(currentIndex)
                        val recoveryPos = _playbackState.value.positionMs.coerceAtLeast(0L)
                        if (recoveryTrack != null) {
                            android.util.Log.i("STUXS_SENTINEL", "[IDLE_RECOVERY_SCHEDULED id=${recoveryTrack.id} pos=${recoveryPos}ms]")
                            idleRecoveryJob = scope.launch {
                                delay(150L)
                                idleRecoveryJob = null
                                if (intentionallyStopped) return@launch
                                android.util.Log.i("STUXS_SENTINEL", "[IDLE_RECOVERY_EXECUTING id=${recoveryTrack.id} pos=${recoveryPos}ms]")
                                prepareAndPlay(recoveryTrack, startPositionMs = recoveryPos)
                            }
                        }
                    }
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                android.util.Log.i("STUXS_SENTINEL", "[EXO_IS_PLAYING isPlaying=" + isPlaying + " playWhenReady=" + exoPlayer.playWhenReady + " state=" + exoPlayer.playbackState + "]")
                if (isPlaying) {
                    consecutiveErrorCount = 0
                    isRecoveringFromError = false
                }
                updateStateFromPlayer()
                if (isPlaying || exoPlayer.playWhenReady) {
                    startProgressTracker()
                } else {
                    stopProgressTracker()
                }
            }

            override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
                android.util.Log.i("STUXS_SENTINEL", "[EXO_DISCONTINUITY reason=" + reason + " oldPos=" + oldPosition.positionMs + " newPos=" + newPosition.positionMs + " playWhenReady=" + exoPlayer.playWhenReady + " state=" + exoPlayer.playbackState + "]")
                updateStateFromPlayer()
            }

            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                android.util.Log.i("STUXS_SENTINEL", "[EXO_MEDIA_ITEM_TRANSITION reason=" + reason + " mediaId=" + mediaItem?.mediaId + "]")
                if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO && mediaItem != null) {
                    val nextIdx = getNextLogicalIndex()
                    if (nextIdx != -1 && nextIdx in currentQueue.indices) {
                        currentIndex = nextIdx
                        val newTrack = currentQueue[currentIndex]
                        _playbackState.value = _playbackState.value.copy(
                            currentTrack = newTrack,
                            currentIndex = currentIndex,
                            positionMs = 0L,
                            durationMs = newTrack.durationMs,
                            state = StateType.PLAYING
                        )
                        invalidateCommands()
                        onTrackChangedListener?.invoke(newTrack, currentIndex)
                        if (exoPlayer.mediaItemCount > 1 && exoPlayer.currentMediaItemIndex > 0) {
                            try { exoPlayer.removeMediaItem(0) } catch (ignored: Exception) {}
                        }
                        scheduleGaplessPreload()
                        fetchArtworkAsync(newTrack)
                    } else {
                        updateStateFromPlayer()
                    }
                } else {
                    updateStateFromPlayer()
                }
                if (exoPlayer.playWhenReady) {
                    startProgressTracker()
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                isRecoveringFromError = false
                consecutiveErrorCount++
                android.util.Log.e("STUXS_SENTINEL", "[PLAYER_ERROR errorCode=" + error.errorCodeName + " count=" + consecutiveErrorCount + " msg=" + error.message + "]", error)
                _playbackState.value = _playbackState.value.copy(
                    state = StateType.ERROR,
                    errorMessage = "Playback Error (${error.errorCodeName}): ${error.message}"
                )
                stopProgressTracker()
                onPlayerErrorListener?.invoke(error)
            }
        })
    }

    private fun startProgressTracker() {
        progressJob?.cancel()
        progressJob = scope.launch {
            while (isActive && (exoPlayer.isPlaying || (exoPlayer.playWhenReady && exoPlayer.playbackState == Player.STATE_BUFFERING))) {
                val playerDuration = exoPlayer.duration
                val track = currentQueue.getOrNull(currentIndex)
                val effectiveDuration = if (playerDuration > 0) playerDuration else (track?.durationMs ?: 0L)
                _playbackState.value = _playbackState.value.copy(
                    positionMs = exoPlayer.currentPosition.coerceAtLeast(0L),
                    durationMs = effectiveDuration,
                    bufferedPositionMs = exoPlayer.bufferedPosition.coerceAtLeast(0L)
                )
                delay(1000L)
            }
        }
    }

    private fun stopProgressTracker() {
        progressJob?.cancel()
        progressJob = null
    }

    private fun updateStateFromPlayer() {
        val oldState = _playbackState.value.state
        val isLogicallyPlaying = exoPlayer.playWhenReady &&
                exoPlayer.playbackState != Player.STATE_IDLE &&
                exoPlayer.playbackState != Player.STATE_ENDED

        val st = when {
            exoPlayer.playerError != null -> StateType.ERROR
            exoPlayer.playbackState == Player.STATE_BUFFERING -> StateType.BUFFERING
            exoPlayer.playbackState == Player.STATE_ENDED -> StateType.ENDED
            exoPlayer.playbackState == Player.STATE_IDLE -> StateType.IDLE
            isLogicallyPlaying -> StateType.PLAYING
            else -> StateType.PAUSED
        }

        val track = currentQueue.getOrNull(currentIndex)
        val playerDuration = exoPlayer.duration
        val effectiveDuration = if (playerDuration > 0) playerDuration else (track?.durationMs ?: 0L)
        val rawPosition = exoPlayer.currentPosition.coerceAtLeast(0L)
        val effectivePosition = if (st == StateType.BUFFERING && effectiveDuration > 0 && rawPosition > effectiveDuration) 0L else rawPosition

        _playbackState.value = _playbackState.value.copy(
            state = st,
            currentTrack = track,
            positionMs = effectivePosition,
            durationMs = effectiveDuration,
            bufferedPositionMs = exoPlayer.bufferedPosition.coerceAtLeast(0L),
            queue = currentQueue.toList(),
            currentIndex = currentIndex
        )

        android.util.Log.i("STUXS_SENTINEL", "[UPDATE_STATE old=" + oldState + " new=" + st + " isPlaying=" + exoPlayer.isPlaying + " playWhenReady=" + exoPlayer.playWhenReady + " exostate=" + exoPlayer.playbackState + "]")
        if (oldState != st) {
            onPlaybackStateChangedListener?.invoke(st)
        }
    }

    fun playTrack(track: NativeTrack, initialPositionMs: Long = 0L) {
        android.util.Log.i("STUXS_SENTINEL", "[TRACK_START id=" + track.id + " title=\"" + track.title + "\" provider=" + track.provider + " isM3U=" + track.isM3U + " duration=" + track.durationMs + "ms initialPos=" + initialPositionMs + "ms]")
        intentionallyStopped = false
        idleRecoveryJob?.cancel()
        idleRecoveryJob = null
        consecutiveErrorCount = 0
        isRecoveringFromError = false
        currentQueue = mutableListOf(track)
        currentIndex = 0
        prepareAndPlay(track, initialPositionMs)
    }

    fun setQueue(queue: List<NativeTrack>, startIndex: Int = 0, initialPositionMs: Long = 0L) {
        if (queue.isEmpty()) return
        android.util.Log.i("STUXS_SENTINEL", "[SET_QUEUE length=" + queue.size + " startIndex=" + startIndex + " initialPos=" + initialPositionMs + "ms]")
        intentionallyStopped = false
        idleRecoveryJob?.cancel()
        idleRecoveryJob = null
        consecutiveErrorCount = 0
        isRecoveringFromError = false
        currentQueue = queue.toMutableList()
        currentIndex = startIndex.coerceIn(0, queue.size - 1)
        prepareAndPlay(currentQueue[currentIndex], initialPositionMs)
    }

    /**
     * Safely fetches artwork, downsamples to max 300x300, and compresses as JPEG.
     * Prevents Android Binder TransactionTooLargeException (1MB limit) and native memory leaks.
     */
    private fun fetchCompressedArtwork(artworkUrl: String?): ByteArray? {
        if (artworkUrl.isNullOrEmpty()) return null
        return try {
            val request = okhttp3.Request.Builder().url(artworkUrl).build()
            okHttpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return null
                val bytes = response.body?.bytes() ?: return null
                val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                var inSampleSize = 1
                while (options.outWidth / (inSampleSize * 2) >= 300 && options.outHeight / (inSampleSize * 2) >= 300) {
                    inSampleSize *= 2
                }
                val decodeOptions = BitmapFactory.Options().apply {
                    this.inSampleSize = inSampleSize
                    inPreferredConfig = Bitmap.Config.RGB_565
                }
                val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, decodeOptions) ?: return null
                val bos = ByteArrayOutputStream()
                bitmap.compress(Bitmap.CompressFormat.JPEG, 75, bos)
                bitmap.recycle()
                bos.toByteArray()
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun fetchArtworkAsync(track: NativeTrack) {
        scope.launch(Dispatchers.IO) {
            val artworkBytes = fetchCompressedArtwork(track.artworkUrl)
            if (artworkBytes != null && isActive) {
                withContext(Dispatchers.Main) {
                    if (currentQueue.getOrNull(currentIndex)?.id == track.id) {
                        val metadata = MediaMetadata.Builder()
                            .setTitle(track.title)
                            .setArtist(track.artist)
                            .setAlbumTitle(track.album)
                            .setArtworkUri(track.artworkUrl?.let { Uri.parse(it) })
                            .setArtworkData(artworkBytes, MediaMetadata.PICTURE_TYPE_FRONT_COVER)
                            .build()
                        exoPlayer.setPlaylistMetadata(metadata)
                    }
                }
            }
        }
    }

    private suspend fun createMediaSourceForTrack(track: NativeTrack): MediaSource? {
        return when (val resolved = sourceResolver.resolveSource(track)) {
            is ResolvedSource.LocalFile -> {
                val mediaItem = buildMediaItem(track, Uri.fromFile(resolved.file))
                ProgressiveMediaSource.Factory(defaultDataSourceFactory).createMediaSource(mediaItem)
            }
            is ResolvedSource.DeviceUri -> {
                val mediaItem = buildMediaItem(track, Uri.parse(resolved.uriString))
                ProgressiveMediaSource.Factory(defaultDataSourceFactory).createMediaSource(mediaItem)
            }
            is ResolvedSource.RemoteStream -> {
                val uri = Uri.parse(resolved.url)
                val mediaItem = buildMediaItem(track, uri)
                if (resolved.isHls) {
                    HlsMediaSource.Factory(defaultDataSourceFactory).createMediaSource(mediaItem)
                } else {
                    ProgressiveMediaSource.Factory(defaultDataSourceFactory).createMediaSource(mediaItem)
                }
            }
            is ResolvedSource.Unavailable -> null
        }
    }

    private fun getNextLogicalIndex(): Int {
        if (currentQueue.isEmpty()) return -1
        if (currentIndex < currentQueue.size - 1) {
            return currentIndex + 1
        }
        if (_playbackState.value.repeatMode == NativeRepeatMode.ALL) {
            return 0
        }
        return -1
    }

    private fun scheduleGaplessPreload() {
        preloadJob?.cancel()
        if (_playbackState.value.repeatMode == NativeRepeatMode.ONE) {
            return
        }
        val nextIdx = getNextLogicalIndex()
        if (nextIdx == -1 || nextIdx !in currentQueue.indices) {
            return
        }
        val nextTrack = currentQueue[nextIdx]
        preloadJob = scope.launch(Dispatchers.Main) {
            val nextSource = withContext(Dispatchers.IO) {
                createMediaSourceForTrack(nextTrack)
            }
            if (nextSource != null && isActive) {
                if (exoPlayer.mediaItemCount == 1) {
                    android.util.Log.i("STUXS_SENTINEL", "[GAPLESS_PRELOAD_ATTACHED id=" + nextTrack.id + " title=\"" + nextTrack.title + "\"]")
                    exoPlayer.addMediaSource(nextSource)
                }
            }
        }
    }

    private fun prepareAndPlay(track: NativeTrack, startPositionMs: Long = 0L, playWhenReady: Boolean = true) {
        android.util.Log.i("STUXS_SENTINEL", "[TRACK_START id=" + track.id + " title=\"" + track.title + "\" index=" + currentIndex + " of " + currentQueue.size + " startPos=" + startPositionMs + "ms playWhenReady=" + playWhenReady + "]")

        prepareJob?.cancel()
        preloadJob?.cancel()
        stopProgressTracker()

        exoPlayer.stop()
        exoPlayer.clearMediaItems()

        val initialMetadata = MediaMetadata.Builder()
            .setTitle(track.title)
            .setArtist(track.artist)
            .setAlbumTitle(track.album)
            .setArtworkUri(track.artworkUrl?.takeIf { it.isNotBlank() }?.let { Uri.parse(it) })
            .build()
        exoPlayer.setPlaylistMetadata(initialMetadata)

        prepareJob = scope.launch {
            _playbackState.value = _playbackState.value.copy(
                state = StateType.BUFFERING,
                currentTrack = track,
                positionMs = startPositionMs,
                durationMs = track.durationMs,
                currentIndex = currentIndex
            )
            invalidateCommands()
            onTrackChangedListener?.invoke(track, currentIndex)

            val mediaSource = withContext(Dispatchers.IO) {
                createMediaSourceForTrack(track)
            }

            if (!isActive) return@launch

            if (mediaSource != null) {
                playMediaSource(mediaSource, startPositionMs, playWhenReady)
                fetchArtworkAsync(track)
                scheduleGaplessPreload()
            } else {
                isRecoveringFromError = false
                exoPlayer.stop()
                exoPlayer.clearMediaItems()
                stopProgressTracker()
                _playbackState.value = _playbackState.value.copy(
                    state = StateType.ERROR,
                    errorMessage = "Cannot play '${track.title}': Source unavailable"
                )
                invalidateCommands()
            }
        }
    }

    fun reloadCurrentTrackSource(newAudioUrl: String, startPositionMs: Long, playWhenReady: Boolean) {
        val currentTrack = currentQueue.getOrNull(currentIndex) ?: return
        android.util.Log.i("STUXS_SENTINEL", "[RELOAD_CURRENT_SOURCE id=" + currentTrack.id + " newUrl=" + newAudioUrl + " pos=" + startPositionMs + "ms playWhenReady=" + playWhenReady + "]")
        val updatedTrack = currentTrack.copy(audioUrl = newAudioUrl)
        currentQueue[currentIndex] = updatedTrack
        prepareAndPlay(updatedTrack, startPositionMs = startPositionMs, playWhenReady = playWhenReady)
    }

    private fun buildMediaItem(track: NativeTrack, uri: Uri): MediaItem {
        val metadata = MediaMetadata.Builder()
            .setTitle(track.title)
            .setArtist(track.artist)
            .setAlbumTitle(track.album)
            .setArtworkUri(track.artworkUrl?.let { Uri.parse(it) })
            .build()

        return MediaItem.Builder()
            .setUri(uri)
            .setMediaId(track.id)
            .setMediaMetadata(metadata)
            .build()
    }

    private fun playMediaSource(mediaSource: MediaSource, startPositionMs: Long = 0L, playWhenReady: Boolean = true) {
        exoPlayer.setMediaSource(mediaSource)
        if (startPositionMs > 0L) {
            exoPlayer.seekTo(startPositionMs)
        }
        exoPlayer.prepare()
        exoPlayer.playWhenReady = playWhenReady
    }

    fun play() {
        if (exoPlayer.playerError != null && currentIndex in currentQueue.indices) {
            if (!isRecoveringFromError && consecutiveErrorCount <= maxErrorRecoveryRetries) {
                val track = currentQueue[currentIndex]
                val lastPos = _playbackState.value.positionMs.coerceAtLeast(0L)
                android.util.Log.i("STUXS_SENTINEL", "[RECOVERING_FROM_ERROR id=${track.id} retry=$consecutiveErrorCount pos=${lastPos}ms]")
                isRecoveringFromError = true
                prepareAndPlay(track, startPositionMs = lastPos)
            } else {
                android.util.Log.w("STUXS_SENTINEL", "[ABORT_ERROR_RECOVERY count=$consecutiveErrorCount isRecovering=$isRecoveringFromError]")
            }
            return
        }

        if (exoPlayer.playbackState == Player.STATE_IDLE && currentIndex in currentQueue.indices) {
            prepareAndPlay(currentQueue[currentIndex])
        } else {
            exoPlayer.play()
        }
    }

    fun pause() {
        exoPlayer.pause()
    }

    fun stop() {
        android.util.Log.i("STUXS_SENTINEL", "[ENGINE_STOP instance=" + hashCode() + "]")
        intentionallyStopped = true
        idleRecoveryJob?.cancel()
        idleRecoveryJob = null
        isRecoveringFromError = false
        consecutiveErrorCount = 0
        prepareJob?.cancel()
        prepareJob = null
        preloadJob?.cancel()
        preloadJob = null
        stopProgressTracker()
        exoPlayer.stop()
        exoPlayer.clearMediaItems()
        _playbackState.value = _playbackState.value.copy(
            state = StateType.IDLE,
            positionMs = 0L,
            currentTrack = null
        )
        invalidateCommands()
    }

    fun togglePlay() {
        if (exoPlayer.isPlaying) {
            pause()
        } else {
            play()
        }
    }

    fun seekTo(positionMs: Long) {
        val safePos = positionMs.coerceAtLeast(0L)
        android.util.Log.i("STUXS_SENTINEL", "[SEEK_TO_CALLED pos=" + positionMs + " safePos=" + safePos + " isPlaying=" + exoPlayer.isPlaying + " playWhenReady=" + exoPlayer.playWhenReady + " exostate=" + exoPlayer.playbackState + "]")
        _playbackState.value = _playbackState.value.copy(positionMs = safePos)
        exoPlayer.seekTo(safePos)
    }

    fun skipToNext(): Boolean {
        if (currentQueue.isEmpty()) return false
        val nextIdx = getNextLogicalIndex()
        if (nextIdx != -1 && nextIdx in currentQueue.indices && exoPlayer.mediaItemCount > 1 && exoPlayer.hasNextMediaItem()) {
            currentIndex = nextIdx
            val nextTrack = currentQueue[currentIndex]
            _playbackState.value = _playbackState.value.copy(
                currentTrack = nextTrack,
                currentIndex = currentIndex,
                positionMs = 0L,
                durationMs = nextTrack.durationMs
            )
            exoPlayer.seekToNextMediaItem()
            invalidateCommands()
            onTrackChangedListener?.invoke(nextTrack, currentIndex)
            if (exoPlayer.currentMediaItemIndex > 0) {
                try { exoPlayer.removeMediaItem(0) } catch (ignored: Exception) {}
            }
            scheduleGaplessPreload()
            fetchArtworkAsync(nextTrack)
            return true
        }
        if (currentIndex < currentQueue.size - 1) {
            currentIndex++
            prepareAndPlay(currentQueue[currentIndex])
            return true
        }
        if (_playbackState.value.repeatMode == NativeRepeatMode.ALL && currentQueue.isNotEmpty()) {
            currentIndex = 0
            prepareAndPlay(currentQueue[0])
            return true
        }
        return false
    }

    fun skipToPrevious(): Boolean {
        if (currentQueue.isEmpty()) return false
        if (exoPlayer.currentPosition > 3000L) {
            seekTo(0L)
            return true
        }
        if (currentIndex > 0) {
            currentIndex--
            prepareAndPlay(currentQueue[currentIndex])
            return true
        }
        seekTo(0L)
        return false
    }

    fun hasNextTrack(): Boolean {
        if (currentQueue.isEmpty()) return false
        if (currentIndex < currentQueue.size - 1) return true
        if (_playbackState.value.repeatMode == NativeRepeatMode.ALL) return true
        return false
    }

    fun hasPreviousTrack(): Boolean {
        if (currentQueue.isEmpty()) return false
        if (currentIndex > 0) return true
        if (_playbackState.value.repeatMode == NativeRepeatMode.ALL) return true
        return true
    }

    fun setRepeatMode(mode: NativeRepeatMode) {
        _playbackState.value = _playbackState.value.copy(repeatMode = mode)
        exoPlayer.repeatMode = when (mode) {
            NativeRepeatMode.OFF -> Player.REPEAT_MODE_OFF
            NativeRepeatMode.ONE -> Player.REPEAT_MODE_ONE
            NativeRepeatMode.ALL -> Player.REPEAT_MODE_OFF // React PlayerContext manages queue wrap-around authoritatively
        }
        if (mode == NativeRepeatMode.ONE && exoPlayer.mediaItemCount > 1) {
            try { exoPlayer.removeMediaItem(1) } catch (ignored: Exception) {}
            preloadJob?.cancel()
        } else {
            scheduleGaplessPreload()
        }
        invalidateCommands()
    }

    fun setShuffleMode(enabled: Boolean) {
        _playbackState.value = _playbackState.value.copy(shuffleEnabled = enabled)
        exoPlayer.shuffleModeEnabled = enabled
        invalidateCommands()
    }

    private fun handleTrackEnded() {
        android.util.Log.i("STUXS_SENTINEL", "[TRACK_END id=" + currentQueue.getOrNull(currentIndex)?.id + " repeatMode=" + _playbackState.value.repeatMode + " currentIndex=" + currentIndex + " queueSize=" + currentQueue.size + "]")
        when (_playbackState.value.repeatMode) {
            NativeRepeatMode.ONE -> {
                seekTo(0L)
                exoPlayer.play()
            }
            NativeRepeatMode.ALL, NativeRepeatMode.OFF -> {
                _playbackState.value = _playbackState.value.copy(
                    state = StateType.ENDED,
                    positionMs = exoPlayer.duration.coerceAtLeast(0L)
                )
                onPlaybackEndedListener?.invoke()
            }
        }
    }

    fun updateQueueOnly(queue: List<NativeTrack>, newIndex: Int? = null) {
        if (queue.isEmpty()) return
        val currentIds = currentQueue.map { it.id }
        val newIds = queue.map { it.id }
        val targetIndex = if (newIndex != null && newIndex in queue.indices) {
            newIndex
        } else {
            val currentId = _playbackState.value.currentTrack?.id
            val matchedIndex = queue.indexOfFirst { it.id == currentId }
            if (matchedIndex != -1) matchedIndex else currentIndex
        }

        // Minimal required update: ignore identical queue and index
        if (currentIds == newIds && currentIndex == targetIndex) {
            return
        }

        android.util.Log.i("STUXS_SENTINEL", "[UPDATE_QUEUE length=" + queue.size + " currentTrackId=" + currentQueue.getOrNull(currentIndex)?.id + " targetIdx=" + targetIndex + "]")
        currentQueue = queue.toMutableList()
        currentIndex = targetIndex.coerceIn(0, (queue.size - 1).coerceAtLeast(0))
        _playbackState.value = _playbackState.value.copy(
            queue = currentQueue.toList(),
            currentIndex = currentIndex
        )

        // Reconcile gapless preloaded item if upcoming queue track changed
        if (exoPlayer.mediaItemCount > 1) {
            val expectedNextIdx = getNextLogicalIndex()
            val expectedNextTrack = if (expectedNextIdx != -1) currentQueue.getOrNull(expectedNextIdx) else null
            val preloadedItem = try { exoPlayer.getMediaItemAt(1) } catch (e: Exception) { null }
            if (preloadedItem == null || expectedNextTrack == null || preloadedItem.mediaId != expectedNextTrack.id) {
                try { exoPlayer.removeMediaItem(1) } catch (ignored: Exception) {}
                scheduleGaplessPreload()
            }
        } else {
            scheduleGaplessPreload()
        }
        invalidateCommands()
    }

    fun getQueue(): List<NativeTrack> = currentQueue.toList()

    fun getCurrentIndex(): Int = currentIndex

    fun release() {
        android.util.Log.w("STUXS_SENTINEL", "[ENGINE_RELEASE instance=" + hashCode() + "]")
        prepareJob?.cancel()
        prepareJob = null
        preloadJob?.cancel()
        preloadJob = null
        stopProgressTracker()
        exoPlayer.release()
        synchronized(StuxsExoPlayerEngine::class.java) {
            if (INSTANCE === this) {
                INSTANCE = null
            }
        }
    }

    companion object {
        @Volatile
        private var INSTANCE: StuxsExoPlayerEngine? = null

        fun getInstance(context: Context): StuxsExoPlayerEngine {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: StuxsExoPlayerEngine(context.applicationContext).also { INSTANCE = it }
            }
        }
    }
}
