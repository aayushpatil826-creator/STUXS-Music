package com.stuxs.music.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.stuxs.music.ui.components.NavDestination
import com.stuxs.music.ui.components.StuxsBottomNav
import com.stuxs.music.ui.components.StuxsEmptyState
import com.stuxs.music.ui.components.StuxsMiniPlayer
import com.stuxs.music.ui.player.NowPlayingModal
import com.stuxs.music.ui.search.NativeSearchScreen
import com.stuxs.music.ui.theme.StuxsBg
import com.stuxs.music.ui.viewmodel.NativePlayerViewModel

@Composable
fun StuxsAppContent(
    viewModel: NativePlayerViewModel,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    var currentNav by remember { mutableStateOf(NavDestination.SEARCH) }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(StuxsBg)
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Main Destination Content
            Box(modifier = Modifier.weight(1f)) {
                when (currentNav) {
                    NavDestination.SEARCH -> {
                        NativeSearchScreen(
                            query = uiState.searchQuery,
                            isSearching = uiState.isSearching,
                            searchResults = uiState.searchResults,
                            currentTrack = uiState.currentTrack,
                            isPlaying = uiState.isPlaying,
                            onQueryChanged = viewModel::onSearchQueryChanged,
                            onTrackClick = { track, list ->
                                viewModel.playTrack(track, list)
                            }
                        )
                    }
                    NavDestination.HOME -> {
                        StuxsEmptyState(
                            title = "Discover Music",
                            subtitle = "Use the Search tab to stream catalog & local songs"
                        )
                    }
                    NavDestination.LIBRARY -> {
                        StuxsEmptyState(
                            title = "Your Library",
                            subtitle = "Tracks played and saved appear here"
                        )
                    }
                }
            }

            // Docked MiniPlayer directly above BottomNav
            if (uiState.currentTrack != null) {
                StuxsMiniPlayer(
                    currentTrack = uiState.currentTrack,
                    isPlaying = uiState.isPlaying,
                    isBuffering = uiState.isBuffering,
                    progress = uiState.progress,
                    isFavorite = uiState.isFavorite,
                    onTogglePlay = viewModel::togglePlay,
                    onSkipNext = viewModel::skipNext,
                    onToggleFavorite = viewModel::toggleFavorite,
                    onClick = { viewModel.setNowPlayingOpen(true) }
                )
            }

            // Bottom Navigation
            StuxsBottomNav(
                currentDestination = currentNav,
                onNavigate = { currentNav = it }
            )
        }

        // Full Screen Now Playing Modal Overlay
        if (uiState.isNowPlayingOpen && uiState.currentTrack != null) {
            NowPlayingModal(
                uiState = uiState,
                onDismiss = { viewModel.setNowPlayingOpen(false) },
                onTogglePlay = viewModel::togglePlay,
                onSkipNext = viewModel::skipNext,
                onSkipPrevious = viewModel::skipPrevious,
                onScrubPosition = viewModel::onScrubPosition,
                onScrubFinished = viewModel::onScrubFinished,
                onSeekTo = viewModel::seekTo,
                onCycleRepeatMode = viewModel::cycleRepeatMode,
                onToggleShuffle = viewModel::toggleShuffle,
                onToggleFavorite = viewModel::toggleFavorite,
                onToggleQueue = { viewModel.setQueueOpen(!uiState.isQueueOpen) },
                onTabSelected = viewModel::setActiveTab,
                onTrackClick = { track ->
                    viewModel.playTrack(track, uiState.queue)
                }
            )
        }
    }
}
