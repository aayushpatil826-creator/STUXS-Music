package com.stuxs.music.lyrics

data class SyncedLyricLine(
    val timeMs: Long,
    val text: String
)

data class LyricsResult(
    val trackId: String? = null,
    val title: String? = null,
    val artist: String? = null,
    val plainLyrics: String? = null,
    val syncedLyrics: List<SyncedLyricLine> = emptyList(),
    val isSynced: Boolean = false
)

object LrcParser {
    private val timeRegex = Regex("\\[(\\d{1,2}):(\\d{1,2})(?:\\.(\\d{1,3}))?\\]")

    /**
     * Parses raw LRC text into a sorted list of SyncedLyricLine.
     */
    fun parse(lrcText: String?): List<SyncedLyricLine> {
        if (lrcText.isNullOrBlank()) return emptyList()

        val lines = lrcText.lines()
        val result = mutableListOf<SyncedLyricLine>()

        for (rawLine in lines) {
            val trimmed = rawLine.trim()
            if (trimmed.isBlank()) continue

            val matches = timeRegex.findAll(trimmed).toList()
            if (matches.isNotEmpty()) {
                val cleanText = trimmed.replace(timeRegex, "").trim()
                for (match in matches) {
                    val minutes = match.groupValues[1].toLongOrNull() ?: 0L
                    val seconds = match.groupValues[2].toLongOrNull() ?: 0L
                    val fractionStr = match.groupValues.getOrNull(3) ?: ""
                    val ms = if (fractionStr.isNotBlank()) {
                        fractionStr.padEnd(3, '0').take(3).toLongOrNull() ?: 0L
                    } else 0L

                    val totalMs = minutes * 60_000L + seconds * 1_000L + ms
                    result.add(SyncedLyricLine(timeMs = totalMs, text = cleanText))
                }
            }
        }

        return result.sortedBy { it.timeMs }
    }

    /**
     * Fast binary search to find active lyric line index for currentTimeMs.
     * Returns -1 if before the first line.
     * Complexity: O(log N) instead of linear scan.
     */
    fun findActiveLyricIndex(syncedLyrics: List<SyncedLyricLine>, currentTimeMs: Long): Int {
        if (syncedLyrics.isEmpty() || currentTimeMs < syncedLyrics[0].timeMs) return -1

        var low = 0
        var high = syncedLyrics.size - 1
        var activeIndex = 0

        while (low <= high) {
            val mid = (low + high) ushr 1
            if (syncedLyrics[mid].timeMs <= currentTimeMs) {
                activeIndex = mid
                low = mid + 1
            } else {
                high = mid - 1
            }
        }

        return activeIndex
    }
}
