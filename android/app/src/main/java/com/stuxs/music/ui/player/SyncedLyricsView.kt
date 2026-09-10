package com.stuxs.music.ui.player

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.stuxs.music.lyrics.SyncedLyricLine
import com.stuxs.music.ui.components.StuxsEmptyState
import com.stuxs.music.ui.theme.*

@Composable
fun SyncedLyricsView(
    lyrics: List<SyncedLyricLine>,
    activeIndex: Int,
    onLineClick: (Long) -> Unit,
    modifier: Modifier = Modifier
) {
    if (lyrics.isEmpty()) {
        StuxsEmptyState(
            title = "No Lyrics Available",
            subtitle = "Instrumental track or lyrics not found for this song",
            modifier = modifier
        )
        return
    }

    val listState = rememberLazyListState()

    // Smoothly scroll to keep active lyric in focus
    LaunchedEffect(activeIndex) {
        if (activeIndex in lyrics.indices) {
            val target = (activeIndex - 2).coerceAtLeast(0)
            listState.animateScrollToItem(target)
        }
    }

    LazyColumn(
        state = listState,
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp),
        contentPadding = PaddingValues(vertical = 40.dp)
    ) {
        itemsIndexed(lyrics) { index, line ->
            val isActive = index == activeIndex

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .clickable { onLineClick(line.timeMs) }
                    .padding(vertical = 10.dp, horizontal = 8.dp),
                contentAlignment = Alignment.CenterStart
            ) {
                Text(
                    text = line.text,
                    color = if (isActive) StuxsAccent else StuxsTextMuted,
                    fontSize = if (isActive) 22.sp else 17.sp,
                    fontWeight = if (isActive) FontWeight.Bold else FontWeight.Medium,
                    lineHeight = if (isActive) 30.sp else 24.sp,
                    textAlign = TextAlign.Start
                )
            }
        }
    }
}
