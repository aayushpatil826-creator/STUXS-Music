package com.stuxs.music.ui.player

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.stuxs.music.nativeplayer.model.NativeTrack
import com.stuxs.music.ui.components.StuxsEmptyState
import com.stuxs.music.ui.components.StuxsTrackRow
import com.stuxs.music.ui.theme.*

@Composable
fun QueueView(
    queue: List<NativeTrack>,
    currentTrack: NativeTrack?,
    isPlaying: Boolean,
    onTrackClick: (NativeTrack) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(StuxsSurface)
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = "Play Queue",
                    color = StuxsText,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "${queue.size} songs",
                    color = StuxsTextSecondary,
                    fontSize = 12.sp
                )
            }

            IconButton(onClick = onClose) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = "Close Queue",
                    tint = StuxsTextSecondary
                )
            }
        }

        if (queue.isEmpty()) {
            StuxsEmptyState(
                title = "Queue is Empty",
                subtitle = "Play a song or playlist to start a queue"
            )
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = 24.dp)
            ) {
                itemsIndexed(queue) { _, track ->
                    val isCurrent = track.id == currentTrack?.id
                    StuxsTrackRow(
                        track = track,
                        isPlaying = isPlaying,
                        isCurrentTrack = isCurrent,
                        onClick = { onTrackClick(track) }
                    )
                }
            }
        }
    }
}
