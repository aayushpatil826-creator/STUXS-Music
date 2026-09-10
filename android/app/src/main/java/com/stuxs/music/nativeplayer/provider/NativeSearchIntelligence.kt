package com.stuxs.music.nativeplayer.provider

import com.stuxs.music.nativeplayer.model.NativeTrack
import java.text.Normalizer
import kotlin.math.max
import kotlin.math.min

object NativeSearchIntelligence {

    val DERIVATIVE_TERMS = listOf(
        "cover", "remix", "mashup", "8d audio", "8d", "slowed", "reverb",
        "lo-fi", "lofi", "tribute", "karaoke", "instrumental", "unofficial",
        "fan made", "fan-made", "bootleg", "edit", "tiktok", "acoustic", "live"
    )

    val FILLER_WORDS = setOf(
        "song", "songs", "music", "audio", "track", "tracks", "official",
        "video", "full", "the", "by", "feat", "ft", "in", "of", "a", "an"
    )

    fun cleanText(text: String?): String {
        if (text.isNullOrBlank()) return ""
        val normalized = Normalizer.normalize(text.lowercase(), Normalizer.Form.NFD)
        return normalized
            .replace(Regex("[\\u0300-\\u036f]"), "") // Strip diacritics
            .replace(Regex("[^\\w\\s]"), " ")       // Strip punctuation
            .replace(Regex("\\s+"), " ")             // Collapse whitespace
            .trim()
    }

    /**
     * Normalizes Indian & Hinglish transliteration equivalences:
     * (aa -> a, ee -> i, oo -> u, bh -> b, dh -> d, jh -> j, sh -> s, w -> v, etc.)
     */
    fun normalizeTransliteration(text: String?): String {
        if (text.isNullOrBlank()) return ""
        return cleanText(text)
            .replace(Regex("aa+"), "a")
            .replace(Regex("ee+"), "i")
            .replace(Regex("oo+"), "u")
            .replace(Regex("ii+"), "i")
            .replace(Regex("uu+"), "u")
            .replace("bh", "b")
            .replace("dh", "d")
            .replace("jh", "j")
            .replace("th", "t")
            .replace("kh", "k")
            .replace("gh", "g")
            .replace("ph", "f")
            .replace("sh", "s")
            .replace("ch", "c")
            .replace("rh", "r")
            .replace("wh", "w")
            .replace("zh", "z")
            .replace("w", "v")
            .replace(Regex("[^\\w\\s]"), "")
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    /**
     * Calculates normalized Levenshtein similarity between 0.0 and 1.0.
     */
    fun fuzzySimilarity(s1: String, s2: String): Double {
        val a = s1.trim()
        val b = s2.trim()
        if (a == b) return 1.0
        if (a.isEmpty() || b.isEmpty()) return 0.0

        val maxLen = max(a.length, b.length)
        val dist = levenshteinDistance(a, b)
        return (1.0 - dist.toDouble() / maxLen).coerceIn(0.0, 1.0)
    }

    private fun levenshteinDistance(a: String, b: String): Int {
        val dp = Array(a.length + 1) { IntArray(b.length + 1) }
        for (i in 0..a.length) dp[i][0] = i
        for (j in 0..b.length) dp[0][j] = j

        for (i in 1..a.length) {
            for (j in 1..b.length) {
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                dp[i][j] = min(
                    min(dp[i - 1][j] + 1, dp[i][j - 1] + 1),
                    dp[i - 1][j - 1] + cost
                )
            }
        }
        return dp[a.length][b.length]
    }

    /**
     * Relevance scoring engine for music search.
     * Ranks original studio tracks highest without provider bias or playlist bias.
     */
    fun scoreTrack(track: NativeTrack, query: String): Double {
        val rawQ = cleanText(query)
        val transQ = normalizeTransliteration(query)
        if (rawQ.isEmpty()) return 0.0

        val rawTitle = cleanText(track.title)
        val transTitle = normalizeTransliteration(track.title)

        val rawArtist = cleanText(track.artist)
        val transArtist = normalizeTransliteration(track.artist)

        val rawAlbum = cleanText(track.album)

        var score = 0.0

        // 1. Exact Title Match
        if (rawTitle == rawQ || transTitle == transQ) {
            score += 250.0
        } else if (rawTitle.startsWith(rawQ) || transTitle.startsWith(transQ)) {
            score += 160.0
        } else if (rawTitle.contains(rawQ) || transTitle.contains(transQ)) {
            score += 110.0
        }

        // 2. Fuzzy Title Match (Typo Tolerance)
        val titleSim = max(fuzzySimilarity(rawTitle, rawQ), fuzzySimilarity(transTitle, transQ))
        if (titleSim >= 0.85) {
            score += titleSim * 140.0
        } else if (titleSim >= 0.70) {
            score += titleSim * 90.0
        }

        // 3. Artist Matching
        if (rawArtist == rawQ || transArtist == transQ) {
            score += 180.0
        } else if (rawArtist.contains(rawQ) || transArtist.contains(transQ)) {
            score += 100.0
        } else {
            val artistSim = max(fuzzySimilarity(rawArtist, rawQ), fuzzySimilarity(transArtist, transQ))
            if (artistSim >= 0.80) {
                score += artistSim * 80.0
            }
        }

        // 4. Token Coverage across Title & Artist
        val queryTokens = rawQ.split(" ").filter { it !in FILLER_WORDS && it.length >= 2 }
        if (queryTokens.isNotEmpty()) {
            var matchedTokens = 0
            for (token in queryTokens) {
                val inTitle = rawTitle.contains(token) || transTitle.contains(token)
                val inArtist = rawArtist.contains(token) || transArtist.contains(token)
                if (inTitle || inArtist) matchedTokens++
            }
            val ratio = matchedTokens.toDouble() / queryTokens.size
            score += ratio * 100.0
        }

        // 5. Canonical Version Preference vs Derivative Terms
        val userWantsDerivative = DERIVATIVE_TERMS.any { rawQ.contains(it) }
        val titleIsDerivative = DERIVATIVE_TERMS.any { rawTitle.contains(it) }

        if (!userWantsDerivative && titleIsDerivative) {
            score -= 140.0 // Derivative penalty for remixes, sped up, live, etc.
        } else if (!titleIsDerivative) {
            score += 120.0 // Canonical studio master bonus
        }

        // 6. Provider Trust Weight
        val providerWeight = when (track.provider.lowercase()) {
            "jiosaavn" -> 120.0
            "gaana" -> 120.0
            "stuxs" -> 120.0
            "local" -> 110.0
            else -> 80.0
        }
        score += providerWeight * 0.1

        return score
    }

    /**
     * Extracts canonical title by stripping movie tags like "(From ...)", "[From ...]"
     */
    fun getCanonicalTitle(title: String): String {
        return normalizeTransliteration(title)
            .replace(Regex("\\(.*\\)"), "")
            .replace(Regex("\\[.*\\]"), "")
            .replace(Regex("from .*"), "")
            .trim()
    }

    /**
     * Deduplicates near-identical song matches from multiple providers,
     * preserving the highest scoring version.
     */
    fun deduplicateTracks(tracks: List<NativeTrack>, query: String): List<NativeTrack> {
        val scored = tracks.map { it to scoreTrack(it, query) }
            .filter { it.second > 20.0 }
            .sortedByDescending { it.second }

        val seenSignatures = mutableMapOf<String, NativeTrack>()
        val output = mutableListOf<NativeTrack>()

        for ((track, score) in scored) {
            val cTitle = getCanonicalTitle(track.title)
            val primaryArtist = normalizeTransliteration(track.artist).split(",")[0].trim()
            val isDerivative = DERIVATIVE_TERMS.any { cleanText(track.title).contains(it) }
            val version = if (isDerivative) cleanText(track.title) else "original"

            val signature = "$cTitle::$primaryArtist::$version"

            if (!seenSignatures.containsKey(signature)) {
                seenSignatures[signature] = track
                output.add(track)
            } else {
                val existing = seenSignatures[signature]!!
                val existingScore = scoreTrack(existing, query)
                if (score > existingScore) {
                    val index = output.indexOf(existing)
                    if (index != -1) {
                        output[index] = track
                        seenSignatures[signature] = track
                    }
                }
            }
        }

        return output
    }
}
