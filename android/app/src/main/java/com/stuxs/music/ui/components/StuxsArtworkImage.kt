package com.stuxs.music.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.SubcomposeAsyncImage
import coil.request.ImageRequest
import com.stuxs.music.ui.theme.StuxsBorder
import com.stuxs.music.ui.theme.StuxsSurfaceTertiary
import com.stuxs.music.ui.theme.StuxsTextMuted

@Composable
fun StuxsArtworkImage(
    artworkUrl: String?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    size: Dp = 48.dp,
    cornerRadius: Dp = 8.dp
) {
    val shape = RoundedCornerShape(cornerRadius)
    val context = LocalContext.current

    SubcomposeAsyncImage(
        model = ImageRequest.Builder(context)
            .data(artworkUrl)
            .crossfade(true)
            .build(),
        contentDescription = contentDescription,
        contentScale = ContentScale.Crop,
        modifier = modifier
            .size(size)
            .clip(shape)
            .background(StuxsSurfaceTertiary, shape),
        loading = {
            Box(
                modifier = Modifier
                    .size(size)
                    .background(StuxsSurfaceTertiary, shape),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.MusicNote,
                    contentDescription = null,
                    tint = StuxsTextMuted,
                    modifier = Modifier.size(size / 2)
                )
            }
        },
        error = {
            Box(
                modifier = Modifier
                    .size(size)
                    .background(StuxsSurfaceTertiary, shape),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.MusicNote,
                    contentDescription = null,
                    tint = StuxsTextMuted,
                    modifier = Modifier.size(size / 2)
                )
            }
        }
    )
}
