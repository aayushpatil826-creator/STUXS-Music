package com.stuxs.music.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.stuxs.music.nativeplayer.model.NativeTrack
import com.stuxs.music.ui.theme.*

@Composable
fun StuxsMiniPlayer(
    currentTrack: NativeTrack?,
    isPlaying: Boolean,
    isBuffering: Boolean,
    progress: Float,
    isFavorite: Boolean,
    onTogglePlay: () -> Unit,
    onSkipNext: () -> Unit,
    onToggleFavorite: () -> Unit,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    if (currentTrack == null) return

    val shape = RoundedCornerShape(16.dp)

    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .clip(shape)
            .background(StuxsSurface, shape)
            .border(1.dp, StuxsBorder, shape)
            .clickable(onClick = onClick)
    ) {
        // Content Row
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Clean high-performance artwork without fake rotating vinyl animation
            StuxsArtworkImage(
                artworkUrl = currentTrack.artworkUrl,
                contentDescription = currentTrack.title,
                size = 44.dp,
                cornerRadius = 10.dp
            )

            Spacer(modifier = Modifier.width(12.dp))

            // Track metadata
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.Center
            ) {
                Text(
                    text = currentTrack.title,
                    color = StuxsText,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = currentTrack.artist,
                    color = StuxsTextSecondary,
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }

            Spacer(modifier = Modifier.width(8.dp))

            // Favorite Button
            IconButton(
                onClick = onToggleFavorite,
                modifier = Modifier.size(36.dp)
            ) {
                Icon(
                    imageVector = if (isFavorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                    contentDescription = "Favorite",
                    tint = if (isFavorite) StuxsAccent else StuxsTextSecondary,
                    modifier = Modifier.size(20.dp)
                )
            }

            // Play / Pause / Loading Button
            IconButton(
                onClick = onTogglePlay,
                modifier = Modifier.size(36.dp)
            ) {
                if (isBuffering) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = StuxsAccent,
                        strokeWidth = 2.dp
                    )
                } else {
                    Icon(
                        imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = if (isPlaying) "Pause" else "Play",
                        tint = StuxsText,
                        modifier = Modifier.size(24.dp)
                    )
                }
            }

            // Skip Next Button
            IconButton(
                onClick = onSkipNext,
                modifier = Modifier.size(36.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.SkipNext,
                    contentDescription = "Skip Next",
                    tint = StuxsTextSecondary,
                    modifier = Modifier.size(22.dp)
                )
            }
        }

        // Thin smooth progress bar line at bottom
        Box(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .fillMaxWidth()
                .height(2.dp)
                .background(StuxsBorder)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(progress.coerceIn(0f, 1f))
                    .background(StuxsAccent)
            )
        }
    }
}
