package com.stuxs.music.nativeplayer.data.repository

import android.content.Context
import com.stuxs.music.nativeplayer.data.DownloadedTrackDao
import com.stuxs.music.nativeplayer.data.DownloadedTrackEntity
import com.stuxs.music.nativeplayer.data.StuxsNativeDatabase
import com.stuxs.music.nativeplayer.model.NativeTrack
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.FileNotFoundException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

class NativeDownloadRepository(
    private val context: Context? = null,
    customDao: DownloadedTrackDao? = null,
    customDownloadsDir: File? = null
) {
    private val database by lazy {
        val ctx = context ?: throw IllegalStateException("Context is required when customDao is not supplied")
        StuxsNativeDatabase.getInstance(ctx)
    }
    private val dao: DownloadedTrackDao = customDao ?: database.downloadedTrackDao()

    private val okHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    private val downloadsDir: File by lazy {
        val dir = customDownloadsDir ?: File(
            context?.filesDir ?: throw IllegalStateException("Context is required when customDownloadsDir is not supplied"),
            "native_downloads"
        )
        if (!dir.exists()) {
            dir.mkdirs()
        }
        dir
    }

    private val activeStagingFiles = ConcurrentHashMap<String, File>()

    private fun sanitizeTrackId(trackId: String): String {
        return trackId.replace(Regex("[^a-zA-Z0-9_-]"), "_")
    }

    private fun getStagingFile(trackId: String): File {
        val sanitized = sanitizeTrackId(trackId)
        return File(downloadsDir, "${sanitized}.stage.tmp")
    }

    private fun getAlternativeTrackIds(trackId: String): List<String> {
        val alts = mutableListOf(trackId)
        if (trackId.startsWith("jiosaavn-track-")) {
            alts.add(trackId.replace("jiosaavn-track-", "jiosaavn-"))
        } else if (trackId.startsWith("jiosaavn-")) {
            alts.add(trackId.replace("jiosaavn-", "jiosaavn-track-"))
        } else if (trackId.startsWith("gaana-track-")) {
            alts.add(trackId.replace("gaana-track-", "gaana-"))
        } else if (trackId.startsWith("gaana-")) {
            alts.add(trackId.replace("gaana-", "gaana-track-"))
        } else if (trackId.startsWith("itunes-track-")) {
            alts.add(trackId.replace("itunes-track-", "itunes-"))
        } else if (trackId.startsWith("itunes-")) {
            alts.add(trackId.replace("itunes-", "itunes-track-"))
        }
        return alts.distinct()
    }

    data class AudioValidationResult(
        val isValidAudio: Boolean,
        val extension: String,
        val mimeType: String,
        val errorMessage: String? = null
    )

    fun inspectAudioFile(file: File): AudioValidationResult {
        if (!file.exists() || file.length() < 10240L) {
            return AudioValidationResult(false, "mp3", "audio/mpeg", "File does not exist or is too small (${file.length()} bytes)")
        }

        val header = ByteArray(64)
        val readBytes = try {
            file.inputStream().use { it.read(header) }
        } catch (e: Exception) {
            return AudioValidationResult(false, "mp3", "audio/mpeg", "Failed to read file header: ${e.message}")
        }

        if (readBytes < 16) {
            return AudioValidationResult(false, "mp3", "audio/mpeg", "File header too short ($readBytes bytes)")
        }

        val headerStr = String(header, 0, readBytes.coerceAtMost(32), Charsets.US_ASCII).trim().lowercase()
        // Reject HTML / XML responses
        if (headerStr.startsWith("<!doctype") || headerStr.startsWith("<html") || headerStr.startsWith("<?xml") || headerStr.contains("<body")) {
            return AudioValidationResult(false, "mp3", "audio/mpeg", "Downloaded stream is HTML/XML error page instead of valid audio")
        }
        // Reject JSON error payloads
        if (headerStr.startsWith("{") && (headerStr.contains("error") || headerStr.contains("code") || headerStr.contains("message") || headerStr.contains("status"))) {
            return AudioValidationResult(false, "mp3", "audio/mpeg", "Downloaded stream is JSON error payload instead of valid audio")
        }

        // Check for MP4 / M4A (ftyp box at byte offset 4)
        if (readBytes >= 8 && header[4] == 'f'.code.toByte() && header[5] == 't'.code.toByte() && header[6] == 'y'.code.toByte() && header[7] == 'p'.code.toByte()) {
            return AudioValidationResult(true, "m4a", "audio/mp4")
        }

        // Check for MP3: ID3 tag at offset 0
        if (readBytes >= 3 && header[0] == 'I'.code.toByte() && header[1] == 'D'.code.toByte() && header[2] == '3'.code.toByte()) {
            return AudioValidationResult(true, "mp3", "audio/mpeg")
        }

        // Check for MP3: MPEG frame sync (0xFF followed by 0xFB, 0xFA, 0xF3, 0xF2)
        if (readBytes >= 2 && (header[0].toInt() and 0xFF) == 0xFF) {
            val second = header[1].toInt() and 0xFF
            if ((second and 0xE0) == 0xE0) {
                val layer = (second ushr 1) and 0x03
                if (layer != 0) {
                    return AudioValidationResult(true, "mp3", "audio/mpeg")
                }
            }
        }

        // Check for AAC ADTS sync: 0xFF followed by 0xF1 or 0xF9
        if (readBytes >= 2 && (header[0].toInt() and 0xFF) == 0xFF && ((header[1].toInt() and 0xF6) == 0xF0)) {
            return AudioValidationResult(true, "m4a", "audio/aac")
        }

        // Check for FLAC (fLaC)
        if (readBytes >= 4 && header[0] == 'f'.code.toByte() && header[1] == 'L'.code.toByte() && header[2] == 'a'.code.toByte() && header[3] == 'C'.code.toByte()) {
            return AudioValidationResult(true, "flac", "audio/flac")
        }

        // Check for OGG (OggS)
        if (readBytes >= 4 && header[0] == 'O'.code.toByte() && header[1] == 'g'.code.toByte() && header[2] == 'g'.code.toByte() && header[3] == 'S'.code.toByte()) {
            return AudioValidationResult(true, "ogg", "audio/ogg")
        }

        // Check for WAV (RIFF....WAVE)
        if (readBytes >= 12 && header[0] == 'R'.code.toByte() && header[1] == 'I'.code.toByte() && header[2] == 'F'.code.toByte() && header[3] == 'F'.code.toByte() &&
            header[8] == 'W'.code.toByte() && header[9] == 'A'.code.toByte() && header[10] == 'V'.code.toByte() && header[11] == 'E'.code.toByte()) {
            return AudioValidationResult(true, "wav", "audio/wav")
        }

        return AudioValidationResult(true, "mp3", "audio/mpeg")
    }

    private fun cleanTitle(title: String?): String {
        if (title.isNullOrBlank()) return ""
        var t = title.lowercase().trim()
        t = t.replace(Regex("\\s*[\\(\\[](official|music video|full video|lyric video|hd|4k|audio)[\\)\\]]", RegexOption.IGNORE_CASE), "")
        return t.trim()
    }

    private fun cleanArtist(artist: String?): String {
        if (artist.isNullOrBlank()) return ""
        val primary = artist.split(Regex("[,&/]|\\s+feat\\.?\\s+|\\s+ft\\.?\\s+", RegexOption.IGNORE_CASE)).firstOrNull() ?: artist
        return primary.lowercase().trim()
    }

    suspend fun isDownloaded(trackId: String): Boolean = withContext(Dispatchers.IO) {
        val idsToCheck = getAlternativeTrackIds(trackId)
        for (id in idsToCheck) {
            val count = dao.isTrackDownloaded(id)
            if (count > 0) {
                val entity = dao.getDownloadedTrackById(id)
                if (entity != null) {
                    val file = File(entity.localFilePath)
                    if (file.exists() && file.length() >= 10240L && inspectAudioFile(file).isValidAudio) {
                        return@withContext true
                    }
                }
            }
        }
        false
    }

    suspend fun getDownloadedEntity(track: NativeTrack): DownloadedTrackEntity? = withContext(Dispatchers.IO) {
        // 1. Direct ID lookup
        val directIds = getAlternativeTrackIds(track.id)
        for (id in directIds) {
            val entity = dao.getDownloadedTrackById(id)
            if (entity != null) {
                val file = File(entity.localFilePath)
                if (file.exists() && file.length() >= 10240L) {
                    val valid = inspectAudioFile(file)
                    if (valid.isValidAudio) {
                        return@withContext entity.copy(mimeType = valid.mimeType)
                    } else {
                        file.delete()
                        dao.deleteDownloadedTrackById(id)
                    }
                } else {
                    dao.deleteDownloadedTrackById(id)
                }
            }
        }

        // 2. Canonical matching if title and artist are available
        val cleanTrackTitle = cleanTitle(track.title)
        val cleanTrackArtist = cleanArtist(track.artist)
        if (cleanTrackTitle.isNotBlank() && cleanTrackArtist.isNotBlank()) {
            val all = dao.getAllDownloadedTracksSync()
            for (entity in all) {
                val entityTitle = cleanTitle(entity.title)
                val entityArtist = cleanArtist(entity.artist)
                if (entityTitle == cleanTrackTitle && entityArtist == cleanTrackArtist) {
                    val durationMatch = track.durationMs <= 0L || entity.durationMs <= 0L ||
                            Math.abs(track.durationMs - entity.durationMs) <= 8000L
                    if (durationMatch) {
                        val file = File(entity.localFilePath)
                        if (file.exists() && file.length() >= 10240L) {
                            val valid = inspectAudioFile(file)
                            if (valid.isValidAudio) {
                                return@withContext entity.copy(mimeType = valid.mimeType)
                            } else {
                                file.delete()
                                dao.deleteDownloadedTrackById(entity.id)
                            }
                        } else {
                            dao.deleteDownloadedTrackById(entity.id)
                        }
                    }
                }
            }
        }

        null
    }

    suspend fun getDownloadedEntity(trackId: String): DownloadedTrackEntity? = withContext(Dispatchers.IO) {
        getDownloadedEntity(NativeTrack(id = trackId, title = "", artist = "", album = "", artworkUrl = "", audioUrl = "", durationMs = 0L, provider = "", isLocal = false))
    }

    suspend fun getDownloadedFile(track: NativeTrack): File? = withContext(Dispatchers.IO) {
        val entity = getDownloadedEntity(track)
        entity?.localFilePath?.let { File(it) }
    }

    suspend fun getDownloadedFile(trackId: String): File? = withContext(Dispatchers.IO) {
        val entity = getDownloadedEntity(trackId)
        entity?.localFilePath?.let { File(it) }
    }

    /**
     * Downloads an audio stream atomically with validation and Room persistence.
     * Uses .tmp file and atomic rename to guarantee integrity.
     */
    suspend fun downloadTrack(
        track: NativeTrack,
        onProgress: ((percent: Int) -> Unit)? = null
    ): Result<DownloadedTrackEntity> = withContext(Dispatchers.IO) {
        val audioUrl = track.audioUrl ?: return@withContext Result.failure(
            IllegalArgumentException("Track has no audioUrl for download")
        )

        val sanitizedId = track.id.replace(Regex("[^a-zA-Z0-9_-]"), "_")
        val ext = if (audioUrl.contains(".m4a") || audioUrl.contains("aac")) "m4a" else "mp3"
        val tempFile = File(downloadsDir, "${sanitizedId}_${System.currentTimeMillis()}.tmp")
        val finalFile = File(downloadsDir, "$sanitizedId.$ext")

        try {
            val request = Request.Builder()
                .url(audioUrl)
                .addHeader("User-Agent", "STUXS-Music-Native/1.2.0 (Android)")
                .build()

            val response = okHttpClient.newCall(request).execute()
            if (!response.isSuccessful) {
                return@withContext Result.failure(
                    Exception("HTTP ${response.code}: ${response.message}")
                )
            }

            val body = response.body ?: return@withContext Result.failure(
                Exception("Empty response body received")
            )

            val contentLength = body.contentLength()
            val inputStream: InputStream = body.byteStream()
            val outputStream = FileOutputStream(tempFile)

            val buffer = ByteArray(8192)
            var totalRead: Long = 0
            var bytesRead: Int

            outputStream.use { out ->
                inputStream.use { input ->
                    while (input.read(buffer).also { bytesRead = it } != -1) {
                        out.write(buffer, 0, bytesRead)
                        totalRead += bytesRead
                        if (contentLength > 0 && onProgress != null) {
                            val percent = ((totalRead * 100) / contentLength).toInt().coerceIn(0, 100)
                            onProgress(percent)
                        }
                    }
                    out.flush()
                    try {
                        out.fd.sync()
                    } catch (_: Exception) {}
                }
            }

            // Verify minimum audio size (>10 KB)
            if (tempFile.length() < 10240L) {
                tempFile.delete()
                return@withContext Result.failure(
                    Exception("Downloaded audio file is too small or corrupt: ${tempFile.length()} bytes")
                )
            }

            val validation = inspectAudioFile(tempFile)
            if (!validation.isValidAudio) {
                tempFile.delete()
                return@withContext Result.failure(
                    Exception("Downloaded audio file validation failed: ${validation.errorMessage ?: "invalid audio format"}")
                )
            }

            val ext = validation.extension
            val finalFile = File(downloadsDir, "$sanitizedId.$ext")

            // Atomic rename
            if (finalFile.exists()) {
                finalFile.delete()
            }
            val renamed = tempFile.renameTo(finalFile)
            if (!renamed) {
                // Fallback copy if rename fails
                tempFile.copyTo(finalFile, overwrite = true)
                tempFile.delete()
            }

            val entity = DownloadedTrackEntity(
                id = track.id,
                title = track.title,
                artist = track.artist,
                album = track.album,
                artworkUrl = track.artworkUrl,
                localFilePath = finalFile.absolutePath,
                mimeType = validation.mimeType,
                fileSize = finalFile.length(),
                durationMs = track.durationMs,
                provider = track.provider,
                downloadedAt = System.currentTimeMillis()
            )

            dao.insertDownloadedTrack(entity)
            Result.success(entity)
        } catch (e: Exception) {
            if (tempFile.exists()) tempFile.delete()
            Result.failure(e)
        }
    }

    suspend fun removeDownload(trackId: String): Boolean = withContext(Dispatchers.IO) {
        val idsToRemove = getAlternativeTrackIds(trackId)
        var anyRemoved = false
        for (id in idsToRemove) {
            val entity = dao.getDownloadedTrackById(id)
            if (entity != null) {
                val file = File(entity.localFilePath)
                if (file.exists()) {
                    file.delete()
                }
                if (dao.deleteDownloadedTrackById(id) > 0) {
                    anyRemoved = true
                }
            }
        }
        anyRemoved
    }

    suspend fun getAllDownloadedTracks(): List<DownloadedTrackEntity> = withContext(Dispatchers.IO) {
        val all = dao.getAllDownloadedTracksSync()
        val seenPaths = mutableSetOf<String>()
        val seenSignatures = mutableSetOf<String>()
        val deduplicated = mutableListOf<DownloadedTrackEntity>()

        for (entity in all) {
            val file = File(entity.localFilePath)
            if (!file.exists() || file.length() < 10240L) {
                // Disk file missing or corrupt -> clean up Room entity
                dao.deleteDownloadedTrackById(entity.id)
                continue
            }

            val validation = inspectAudioFile(file)
            if (!validation.isValidAudio) {
                file.delete()
                dao.deleteDownloadedTrackById(entity.id)
                continue
            }

            val pathKey = file.canonicalPath
            val durBucket = if (entity.durationMs > 0) (entity.durationMs / 5000L) else 0L
            val sigKey = "${cleanTitle(entity.title)}::${cleanArtist(entity.artist)}::${entity.album?.trim()?.lowercase() ?: ""}::$durBucket"

            if (seenPaths.contains(pathKey) || seenSignatures.contains(sigKey)) {
                // Redundant duplicate entry in Room pointing to the same file or identical title/artist
                dao.deleteDownloadedTrackById(entity.id)
                continue
            }

            seenPaths.add(pathKey)
            seenSignatures.add(sigKey)
            deduplicated.add(entity.copy(mimeType = validation.mimeType))
        }
        deduplicated
    }

    /**
     * Safely purges unreferenced staging/temp files and unreferenced audio files older than olderThanMs.
     * Safe age rule: never delete actively staging files, never delete files referenced by Room DB,
     * and never delete files modified less than 10 minutes ago.
     */
    suspend fun purgeOrphanFiles(olderThanMs: Long = 10 * 60 * 1000L): Int = withContext(Dispatchers.IO) {
        val now = System.currentTimeMillis()
        val cutoff = now - olderThanMs
        var purgedCount = 0

        val activePaths = activeStagingFiles.values.map { it.absolutePath }.toSet()
        val roomPaths = dao.getAllDownloadedTracksSync().map { it.localFilePath }.toSet()

        val files = downloadsDir.listFiles() ?: return@withContext 0
        for (file in files) {
            val path = file.absolutePath
            if (activePaths.contains(path) || roomPaths.contains(path)) {
                continue
            }

            // Must be older than cutoff to guarantee it is not an active in-flight operation
            if (file.lastModified() < cutoff) {
                val isStaging = file.name.endsWith(".tmp") || file.name.endsWith(".stage.tmp")
                val isAudio = file.name.endsWith(".mp3") || file.name.endsWith(".m4a")
                if (isStaging || isAudio) {
                    if (file.delete()) {
                        purgedCount++
                    }
                }
            }
        }
        purgedCount
    }

    /**
     * Initializes a .tmp staging file for chunked audio download.
     * Cleans up any prior incomplete staging file for this trackId.
     */
    suspend fun beginChunkedDownload(trackId: String, extension: String = "mp3"): File = withContext(Dispatchers.IO) {
        val stagingFile = getStagingFile(trackId)
        if (stagingFile.exists()) {
            stagingFile.delete()
        }
        stagingFile.parentFile?.mkdirs()
        stagingFile.createNewFile()
        activeStagingFiles[trackId] = stagingFile
        stagingFile
    }

    /**
     * Appends a chunk of audio bytes to the .tmp staging file.
     */
    suspend fun appendChunk(trackId: String, chunkData: ByteArray): Long = withContext(Dispatchers.IO) {
        val stagingFile = activeStagingFiles[trackId] ?: getStagingFile(trackId)
        if (!stagingFile.exists()) {
            stagingFile.parentFile?.mkdirs()
            stagingFile.createNewFile()
            activeStagingFiles[trackId] = stagingFile
        }

        FileOutputStream(stagingFile, true).use { out ->
            out.write(chunkData)
            out.flush()
            try {
                out.fd.sync()
            } catch (_: Exception) {}
        }
        stagingFile.length()
    }

    /**
     * Commits a completed chunked download:
     * 1. Validates that staging file exists and length >= 10240 bytes (10KB).
     * 2. Inspects audio magic bytes to verify valid audio format (not HTML / JSON error).
     * 3. Atomically renames .tmp file to final persistent file (with copy fallback).
     * 4. Validates final file integrity and audio format.
     * 5. Inserts/updates Room DownloadedTrackEntity with verified mimeType.
     * 6. If Room write fails, rolls back the disk file to avoid orphaned files.
     */
    suspend fun commitChunkedDownload(
        entity: DownloadedTrackEntity
    ): Result<DownloadedTrackEntity> = withContext(Dispatchers.IO) {
        val trackId = entity.id
        val stagingFile = activeStagingFiles[trackId] ?: getStagingFile(trackId)

        if (!stagingFile.exists()) {
            return@withContext Result.failure(
                FileNotFoundException("Staging file does not exist for trackId: $trackId")
            )
        }

        val stagingLength = stagingFile.length()
        if (stagingLength < 10240L) {
            stagingFile.delete()
            activeStagingFiles.remove(trackId)
            return@withContext Result.failure(
                IllegalStateException("Downloaded audio file is too small or corrupt: $stagingLength bytes (minimum 10240 bytes required)")
            )
        }

        val validation = inspectAudioFile(stagingFile)
        if (!validation.isValidAudio) {
            stagingFile.delete()
            activeStagingFiles.remove(trackId)
            return@withContext Result.failure(
                IllegalStateException("Downloaded audio validation failed: ${validation.errorMessage ?: "invalid audio format"}")
            )
        }

        val sanitizedId = sanitizeTrackId(trackId)
        val ext = validation.extension
        val finalFile = File(downloadsDir, "$sanitizedId.$ext")

        if (finalFile.exists()) {
            finalFile.delete()
        }

        val renamed = stagingFile.renameTo(finalFile)
        if (!renamed) {
            try {
                stagingFile.copyTo(finalFile, overwrite = true)
                stagingFile.delete()
            } catch (e: Exception) {
                if (stagingFile.exists()) stagingFile.delete()
                activeStagingFiles.remove(trackId)
                return@withContext Result.failure(e)
            }
        }

        if (!finalFile.exists() || finalFile.length() < 10240L) {
            if (finalFile.exists()) finalFile.delete()
            activeStagingFiles.remove(trackId)
            return@withContext Result.failure(
                IllegalStateException("Final audio file verification failed after atomic rename")
            )
        }

        val finalValidation = inspectAudioFile(finalFile)
        if (!finalValidation.isValidAudio) {
            if (finalFile.exists()) finalFile.delete()
            activeStagingFiles.remove(trackId)
            return@withContext Result.failure(
                IllegalStateException("Final audio file validation failed after atomic rename: ${finalValidation.errorMessage}")
            )
        }

        val verifiedEntity = entity.copy(
            localFilePath = finalFile.absolutePath,
            fileSize = finalFile.length(),
            mimeType = finalValidation.mimeType,
            downloadedAt = if (entity.downloadedAt > 0) entity.downloadedAt else System.currentTimeMillis()
        )

        try {
            dao.insertDownloadedTrack(verifiedEntity)
            activeStagingFiles.remove(trackId)
            Result.success(verifiedEntity)
        } catch (e: Exception) {
            if (finalFile.exists()) finalFile.delete()
            activeStagingFiles.remove(trackId)
            Result.failure(e)
        }
    }

    suspend fun commitChunkedDownload(
        trackId: String,
        entity: DownloadedTrackEntity
    ): Result<DownloadedTrackEntity> = commitChunkedDownload(entity.copy(id = trackId))

    /**
     * Aborts chunked download and deletes any .tmp staging file for trackId.
     */
    suspend fun abortChunkedDownload(trackId: String): Boolean = withContext(Dispatchers.IO) {
        val stagingFile = activeStagingFiles.remove(trackId) ?: getStagingFile(trackId)
        if (stagingFile.exists()) {
            stagingFile.delete()
        } else {
            true
        }
    }

    suspend fun getAllTrackIds(): List<String> = withContext(Dispatchers.IO) {
        dao.getAllTrackIds()
    }

    suspend fun existsById(trackId: String): Boolean = withContext(Dispatchers.IO) {
        dao.existsById(trackId)
    }
}
