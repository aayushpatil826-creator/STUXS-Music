package com.stuxs.music.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.stuxs.music.ui.theme.StuxsAccent
import com.stuxs.music.ui.theme.StuxsBorderLight
import com.stuxs.music.ui.theme.StuxsTextMuted

@Composable
fun StuxsProgressBar(
    positionMs: Long,
    durationMs: Long,
    progress: Float,
    onScrubPosition: (Float) -> Unit,
    onScrubFinished: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Slider(
            value = progress.coerceIn(0f, 1f),
            onValueChange = { fraction ->
                onScrubPosition(fraction)
            },
            onValueChangeFinished = {
                onScrubFinished()
            },
            colors = SliderDefaults.colors(
                thumbColor = StuxsAccent,
                activeTrackColor = StuxsAccent,
                inactiveTrackColor = StuxsBorderLight
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(24.dp)
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = formatDuration(positionMs),
                color = StuxsTextMuted,
                fontSize = 12.sp
            )
            Text(
                text = formatDuration(durationMs),
                color = StuxsTextMuted,
                fontSize = 12.sp
            )
        }
    }
}

fun formatDuration(ms: Long): String {
    val totalSec = (ms / 1000L).coerceAtLeast(0L)
    val minutes = totalSec / 60L
    val seconds = totalSec % 60L
    return "%d:%02d".format(minutes, seconds)
}
