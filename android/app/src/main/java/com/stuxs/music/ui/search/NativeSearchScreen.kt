package com.stuxs.music.ui.search

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.stuxs.music.nativeplayer.model.NativeTrack
import com.stuxs.music.ui.components.StuxsEmptyState
import com.stuxs.music.ui.components.StuxsLoadingState
import com.stuxs.music.ui.components.StuxsTrackRow
import com.stuxs.music.ui.theme.*

@Composable
fun NativeSearchScreen(
    query: String,
    isSearching: Boolean,
    searchResults: List<NativeTrack>,
    currentTrack: NativeTrack?,
    isPlaying: Boolean,
    onQueryChanged: (String) -> Unit,
    onTrackClick: (NativeTrack, List<NativeTrack>) -> Unit,
    modifier: Modifier = Modifier
) {
    val focusManager = LocalFocusManager.current
    val searchShape = RoundedCornerShape(14.dp)

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(StuxsBg)
            .statusBarsPadding()
    ) {
        // Search Input Bar
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp)
                .clip(searchShape)
                .background(StuxsSurface, searchShape)
                .border(1.dp, StuxsBorder, searchShape)
        ) {
            TextField(
                value = query,
                onValueChange = onQueryChanged,
                placeholder = {
                    Text(
                        text = "Songs, artists, or M3U streams...",
                        color = StuxsTextMuted,
                        fontSize = 14.sp
                    )
                },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Default.Search,
                        contentDescription = "Search",
                        tint = StuxsTextSecondary
                    )
                },
                trailingIcon = {
                    if (query.isNotEmpty()) {
                        IconButton(onClick = { onQueryChanged("") }) {
                            Icon(
                                imageVector = Icons.Default.Clear,
                                contentDescription = "Clear",
                                tint = StuxsTextSecondary
                            )
                        }
                    }
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { focusManager.clearFocus() }),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = StuxsSurface,
                    unfocusedContainerColor = StuxsSurface,
                    disabledContainerColor = StuxsSurface,
                    focusedTextColor = StuxsText,
                    unfocusedTextColor = StuxsText,
                    cursorColor = StuxsAccent,
                    focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                    unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent
                ),
                modifier = Modifier.fillMaxWidth()
            )
        }

        // Results or States
        when {
            isSearching -> {
                StuxsLoadingState(message = "Searching verified providers...")
            }
            query.isBlank() -> {
                StuxsEmptyState(
                    title = "Search STUXS Music",
                    subtitle = "Search for songs across JioSaavn, Gaana, STUXS catalog, or local streams",
                    icon = Icons.Default.Search
                )
            }
            searchResults.isEmpty() -> {
                StuxsEmptyState(
                    title = "No Matching Tracks",
                    subtitle = "Try checking spelling or searching for artist/album name",
                    icon = Icons.Default.Search
                )
            }
            else -> {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(bottom = 80.dp)
                ) {
                    itemsIndexed(searchResults) { _, track ->
                        val isCurrent = track.id == currentTrack?.id
                        StuxsTrackRow(
                            track = track,
                            isPlaying = isPlaying,
                            isCurrentTrack = isCurrent,
                            onClick = { onTrackClick(track, searchResults) }
                        )
                    }
                }
            }
        }
    }
}
