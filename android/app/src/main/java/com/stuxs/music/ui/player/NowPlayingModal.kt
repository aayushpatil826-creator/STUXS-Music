package com.stuxs.music.ui.player

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.stuxs.music.nativeplayer.model.NativeRepeatMode
import com.stuxs.music.nativeplayer.model.NativeTrack
import com.stuxs.music.ui.components.StuxsArtworkImage
import com.stuxs.music.ui.components.StuxsProgressBar
import com.stuxs.music.ui.theme.*
import com.stuxs.music.ui.viewmodel.NowPlayingTab
import com.stuxs.music.ui.viewmodel.PlayerUiState

@Composable
fun NowPlayingModal(
    uiState: PlayerUiState,
    onDismiss: () -> Unit,
    onTogglePlay: () -> Unit,
    onSkipNext: () -> Unit,
    onSkipPrevious: () -> Unit,
    onScrubPosition: (Float) -> Unit,
    onScrubFinished: () -> Unit,
    onSeekTo: (Long) -> Unit,
    onCycleRepeatMode: () -> Unit,
    onToggleShuffle: () -> Unit,
    onToggleFavorite: () -> Unit,
    onToggleQueue: () -> Unit,
    onTabSelected: (NowPlayingTab) -> Unit,
    onTrackClick: (NativeTrack) -> Unit,
    modifier: Modifier = Modifier
) {
    val track = uiState.currentTrack ?: return

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(StuxsBg)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp)
                .statusBarsPadding()
                .navigationBarsPadding(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            // 1. Top Bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onDismiss) {
                    Icon(
                        imageVector = Icons.Default.KeyboardArrowDown,
                        contentDescription = "Dismiss",
                        tint = StuxsText,
                        modifier = Modifier.size(32.dp)
                    )
                }

                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = "PLAYING FROM ${track.provider.uppercase()}",
                        color = StuxsTextMuted,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.sp
                    )
                    Text(
                        text = track.album ?: "STUXS Music",
                        color = StuxsTextSecondary,
                        fontSize = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                IconButton(onClick = { /* Menu */ }) {
                    Icon(
                        imageVector = Icons.Default.MoreVert,
                        contentDescription = "Options",
                        tint = StuxsTextSecondary
                    )
                }
            }

            // 2. Center Area: Artwork or Synced Lyrics
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(vertical = 16.dp),
                contentAlignment = Alignment.Center
            ) {
                if (uiState.activeTab == NowPlayingTab.ARTWORK) {
                    // Large artwork card
                    StuxsArtworkImage(
                        artworkUrl = track.artworkUrl,
                        contentDescription = track.title,
                        size = 280.dp,
                        cornerRadius = 24.dp,
                        modifier = Modifier
                            .shadow(24.dp, RoundedCornerShape(24.dp), spotColor = StuxsAccentGlow)
                    )
                } else {
                    // Synced Lyrics View
                    SyncedLyricsView(
                        lyrics = uiState.syncedLyrics,
                        activeIndex = uiState.activeLyricIndex,
                        onLineClick = onSeekTo
                    )
                }
            }

            // 3. Track Info (Title, Artist, Favorite)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = track.title,
                        color = StuxsText,
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = track.artist,
                        color = StuxsTextSecondary,
                        fontSize = 16.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                IconButton(onClick = onToggleFavorite) {
                    Icon(
                        imageVector = if (uiState.isFavorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                        contentDescription = "Favorite",
                        tint = if (uiState.isFavorite) StuxsAccent else StuxsTextSecondary,
                        modifier = Modifier.size(28.dp)
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // 4. Progress Bar / Slider
            StuxsProgressBar(
                positionMs = uiState.positionMs,
                durationMs = uiState.durationMs,
                progress = uiState.progress,
                onScrubPosition = onScrubPosition,
                onScrubFinished = onScrubFinished
            )

            Spacer(modifier = Modifier.height(12.dp))

            // 5. Main Transport Controls
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Shuffle Button
                IconButton(onClick = onToggleShuffle) {
                    Icon(
                        imageVector = Icons.Default.Shuffle,
                        contentDescription = "Shuffle",
                        tint = if (uiState.shuffleEnabled) StuxsAccent else StuxsTextMuted
                    )
                }

                // Previous Button
                IconButton(
                    onClick = onSkipPrevious,
                    modifier = Modifier.size(48.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.SkipPrevious,
                        contentDescription = "Previous",
                        tint = StuxsText,
                        modifier = Modifier.size(34.dp)
                    )
                }

                // Play / Pause / Buffering Button (Circular prominent)
                Box(
                    modifier = Modifier
                        .size(64.dp)
                        .clip(CircleShape)
                        .background(StuxsAccent)
                        .shadow(16.dp, CircleShape, spotColor = StuxsAccentGlow),
                    contentAlignment = Alignment.Center
                ) {
                    IconButton(
                        onClick = onTogglePlay,
                        modifier = Modifier.fillMaxSize()
                    ) {
                        if (uiState.isBuffering) {
                            CircularProgressIndicator(
                                color = StuxsText,
                                modifier = Modifier.size(28.dp),
                                strokeWidth = 3.dp
                            )
                        } else {
                            Icon(
                                imageVector = if (uiState.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                                contentDescription = if (uiState.isPlaying) "Pause" else "Play",
                                tint = StuxsText,
                                modifier = Modifier.size(36.dp)
                            )
                        }
                    }
                }

                // Next Button
                IconButton(
                    onClick = onSkipNext,
                    modifier = Modifier.size(48.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.SkipNext,
                        contentDescription = "Next",
                        tint = StuxsText,
                        modifier = Modifier.size(34.dp)
                    )
                }

                // Repeat Mode Button
                IconButton(onClick = onCycleRepeatMode) {
                    val repeatIcon = when (uiState.repeatMode) {
                        NativeRepeatMode.ONE -> Icons.Default.RepeatOne
                        else -> Icons.Default.Repeat
                    }
                    val repeatTint = when (uiState.repeatMode) {
                        NativeRepeatMode.OFF -> StuxsTextMuted
                        else -> StuxsAccent
                    }
                    Icon(
                        imageVector = repeatIcon,
                        contentDescription = "Repeat",
                        tint = repeatTint
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // 6. Bottom Utilities Row (Lyrics toggle, Queue toggle)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Lyrics Toggle
                IconButton(
                    onClick = {
                        val next = if (uiState.activeTab == NowPlayingTab.ARTWORK) NowPlayingTab.LYRICS else NowPlayingTab.ARTWORK
                        onTabSelected(next)
                    }
                ) {
                    Icon(
                        imageVector = Icons.Default.Lyrics,
                        contentDescription = "Lyrics",
                        tint = if (uiState.activeTab == NowPlayingTab.LYRICS) StuxsAccent else StuxsTextMuted,
                        modifier = Modifier.size(24.dp)
                    )
                }

                // Queue Toggle
                IconButton(onClick = onToggleQueue) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.QueueMusic,
                        contentDescription = "Queue",
                        tint = StuxsTextMuted,
                        modifier = Modifier.size(26.dp)
                    )
                }
            }
        }

        // Queue Sheet Overlay
        if (uiState.isQueueOpen) {
            QueueView(
                queue = uiState.queue,
                currentTrack = uiState.currentTrack,
                isPlaying = uiState.isPlaying,
                onTrackClick = onTrackClick,
                onClose = onToggleQueue
            )
        }
    }
}
