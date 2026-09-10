package com.stuxs.music.nativeplayer.provider

import com.stuxs.music.nativeplayer.model.NativeTrack

data class NativeArtist(
    val id: String,
    val name: String,
    val artworkUrl: String? = null,
    val isVerified: Boolean = true
)

data class NativeAlbum(
    val id: String,
    val title: String,
    val artistName: String,
    val artworkUrl: String? = null,
    val releaseDate: String? = null,
    val trackCount: Int = 1
)

data class NativePlaylist(
    val id: String,
    val name: String,
    val description: String? = null,
    val artworkUrl: String? = null,
    val songCount: Int = 0
)

data class NativeSearchResults(
    val tracks: List<NativeTrack> = emptyList(),
    val artists: List<NativeArtist> = emptyList(),
    val albums: List<NativeAlbum> = emptyList(),
    val playlists: List<NativePlaylist> = emptyList()
)

interface NativeMusicProvider {
    val id: String
    val name: String
    val isAvailable: Boolean

    suspend fun search(query: String): NativeSearchResults
    suspend fun getTrack(id: String): NativeTrack?
    suspend fun resolveStreamUrl(track: NativeTrack): String?
}
