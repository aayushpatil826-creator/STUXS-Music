package com.stuxs.music.ui.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.stuxs.music.lyrics.LrcParser
import com.stuxs.music.lyrics.SyncedLyricLine
import com.stuxs.music.nativeplayer.engine.StuxsExoPlayerEngine
import com.stuxs.music.nativeplayer.model.NativePlaybackState
import com.stuxs.music.nativeplayer.model.NativeRepeatMode
import com.stuxs.music.nativeplayer.model.NativeTrack
import com.stuxs.music.nativeplayer.model.StateType
import com.stuxs.music.nativeplayer.provider.NativeSearchEngine
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

enum class NowPlayingTab {
    ARTWORK,
    LYRICS
}

data class PlayerUiState(
    val currentTrack: NativeTrack? = null,
    val isPlaying: Boolean = false,
    val isBuffering: Boolean = false,
    val positionMs: Long = 0L,
    val durationMs: Long = 0L,
    val progress: Float = 0f,
    val bufferedPositionMs: Long = 0L,
    val repeatMode: NativeRepeatMode = NativeRepeatMode.OFF,
    val shuffleEnabled: Boolean = false,
    val isNowPlayingOpen: Boolean = false,
    val isQueueOpen: Boolean = false,
    val activeTab: NowPlayingTab = NowPlayingTab.ARTWORK,
    val queue: List<NativeTrack> = emptyList(),
    val isFavorite: Boolean = false,
    val syncedLyrics: List<SyncedLyricLine> = emptyList(),
    val activeLyricIndex: Int = -1,
    val isSearching: Boolean = false,
    val searchQuery: String = "",
    val searchResults: List<NativeTrack> = emptyList(),
    val errorMessage: String? = null
)

@OptIn(FlowPreview::class)
class NativePlayerViewModel(
    application: Application,
    private val engine: StuxsExoPlayerEngine = StuxsExoPlayerEngine.getInstance(application),
    private val searchEngine: NativeSearchEngine = NativeSearchEngine()
) : AndroidViewModel(application) {

    private val _uiState = MutableStateFlow(PlayerUiState())
    val uiState: StateFlow<PlayerUiState> = _uiState.asStateFlow()

    private val _searchQueryFlow = MutableStateFlow("")
    private var positionTickerJob: Job? = null
    private var isUserScrubbing = false

    init {
        // 1. Observe authoritative native playback engine state
        viewModelScope.launch {
            engine.playbackState.collect { state ->
                handleEngineStateChange(state)
            }
        }

        // 2. Set up search debounce with 300ms delay
        _searchQueryFlow
            .debounce(300)
            .distinctUntilChanged()
            .onEach { query ->
                executeSearch(query)
            }
            .launchIn(viewModelScope)
    }

    private fun handleEngineStateChange(state: NativePlaybackState) {
        val isPlaying = state.state == StateType.PLAYING
        val isBuffering = state.state == StateType.BUFFERING

        val trackChanged = _uiState.value.currentTrack?.id != state.currentTrack?.id

        _uiState.update { current ->
            val duration = if (state.durationMs > 0) state.durationMs else current.durationMs
            val position = if (!isUserScrubbing) state.positionMs else current.positionMs
            val progress = if (duration > 0) (position.toFloat() / duration).coerceIn(0f, 1f) else 0f

            current.copy(
                currentTrack = state.currentTrack,
                isPlaying = isPlaying,
                isBuffering = isBuffering,
                positionMs = position,
                durationMs = duration,
                progress = progress,
                bufferedPositionMs = state.bufferedPositionMs,
                repeatMode = state.repeatMode,
                shuffleEnabled = state.shuffleEnabled,
                queue = engine.getQueue(),
                errorMessage = state.errorMessage
            )
        }

        if (trackChanged && state.currentTrack != null) {
            loadLyricsForTrack(state.currentTrack)
        }

        // Controlled position updater: Runs only while playing with 500ms ticker
        if (isPlaying) {
            startControlledPositionTicker()
        } else {
            stopControlledPositionTicker()
        }
    }

    /**
     * Updates playback position and active lyric line at a controlled 500ms interval.
     * Never floods Compose with frequent millisecond state updates.
     */
    private fun startControlledPositionTicker() {
        if (positionTickerJob?.isActive == true) return
        positionTickerJob = viewModelScope.launch {
            while (isActive && _uiState.value.isPlaying) {
                delay(500L)
                if (!isUserScrubbing) {
                    val currentPos = engine.exoPlayer.currentPosition
                    val duration = engine.exoPlayer.duration.coerceAtLeast(1L)
                    val progress = (currentPos.toFloat() / duration).coerceIn(0f, 1f)

                    val lyrics = _uiState.value.syncedLyrics
                    val activeIndex = if (lyrics.isNotEmpty()) {
                        LrcParser.findActiveLyricIndex(lyrics, currentPos)
                    } else -1

                    _uiState.update {
                        it.copy(
                            positionMs = currentPos,
                            durationMs = if (it.durationMs > 0) it.durationMs else duration,
                            progress = progress,
                            activeLyricIndex = activeIndex
                        )
                    }
                }
            }
        }
    }

    private fun stopControlledPositionTicker() {
        positionTickerJob?.cancel()
        positionTickerJob = null
    }

    fun playTrack(track: NativeTrack, queue: List<NativeTrack> = emptyList()) {
        val finalQueue = if (queue.isNotEmpty()) queue else listOf(track)
        val startIndex = finalQueue.indexOfFirst { it.id == track.id }.coerceAtLeast(0)
        engine.setQueue(finalQueue, startIndex)
        _uiState.update { it.copy(queue = finalQueue) }
    }

    fun togglePlay() {
        if (_uiState.value.isPlaying) {
            engine.pause()
        } else {
            engine.play()
        }
    }

    fun skipNext() {
        engine.skipToNext()
    }

    fun skipPrevious() {
        engine.skipToPrevious()
    }

    /**
     * Immediate scrubbing update for UI slider fluidity without engine delay.
     */
    fun onScrubPosition(fraction: Float) {
        isUserScrubbing = true
        val duration = _uiState.value.durationMs
        val targetPos = (duration * fraction).toLong()
        _uiState.update {
            it.copy(
                positionMs = targetPos,
                progress = fraction.coerceIn(0f, 1f)
            )
        }
    }

    /**
     * Dispatches seek to native ExoPlayer only when scrubbing completes.
     */
    fun onScrubFinished() {
        isUserScrubbing = false
        val targetPos = _uiState.value.positionMs
        engine.seekTo(targetPos)
    }

    fun seekTo(positionMs: Long) {
        engine.seekTo(positionMs)
        _uiState.update {
            val progress = if (it.durationMs > 0) (positionMs.toFloat() / it.durationMs).coerceIn(0f, 1f) else 0f
            it.copy(positionMs = positionMs, progress = progress)
        }
    }

    fun cycleRepeatMode() {
        val nextMode = when (_uiState.value.repeatMode) {
            NativeRepeatMode.OFF -> NativeRepeatMode.ALL
            NativeRepeatMode.ALL -> NativeRepeatMode.ONE
            NativeRepeatMode.ONE -> NativeRepeatMode.OFF
        }
        engine.setRepeatMode(nextMode)
    }

    fun toggleShuffle() {
        val newShuffle = !_uiState.value.shuffleEnabled
        engine.setShuffleMode(newShuffle)
    }

    fun toggleFavorite() {
        _uiState.update { it.copy(isFavorite = !it.isFavorite) }
    }

    fun setNowPlayingOpen(open: Boolean) {
        _uiState.update { it.copy(isNowPlayingOpen = open) }
    }

    fun setQueueOpen(open: Boolean) {
        _uiState.update { it.copy(isQueueOpen = open) }
    }

    fun setActiveTab(tab: NowPlayingTab) {
        _uiState.update { it.copy(activeTab = tab) }
    }

    fun onSearchQueryChanged(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
        _searchQueryFlow.value = query
    }

    private suspend fun executeSearch(query: String) {
        val q = query.trim()
        if (q.isBlank()) {
            _uiState.update { it.copy(searchResults = emptyList(), isSearching = false) }
            return
        }

        _uiState.update { it.copy(isSearching = true) }
        try {
            val results = searchEngine.search(q)
            _uiState.update { it.copy(searchResults = results, isSearching = false) }
        } catch (e: Exception) {
            _uiState.update { it.copy(isSearching = false) }
        }
    }

    private fun loadLyricsForTrack(track: NativeTrack) {
        viewModelScope.launch {
            // Check if track has bundled LRC or mock synchronized sample
            val parsed = if (!track.lyricsLrc.isNullOrBlank()) {
                LrcParser.parse(track.lyricsLrc)
            } else {
                emptyList()
            }
            _uiState.update {
                it.copy(
                    syncedLyrics = parsed,
                    activeLyricIndex = if (parsed.isNotEmpty()) 0 else -1
                )
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        stopControlledPositionTicker()
    }
}
