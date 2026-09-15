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

    suspend fun isDownloaded(trackId: String): Boolean = withContext(Dispatchers.IO) {
        val idsToCheck = getAlternativeTrackIds(trackId)
        for (id in idsToCheck) {
            val count = dao.isTrackDownloaded(id)
            if (count > 0) {
                val entity = dao.getDownloadedTrackById(id)
                if (entity != null) {
                    val file = File(entity.localFilePath)
                    if (file.exists() && file.length() >= 10240L) {
                        return@withContext true
                    }
                }
            }
        }
        false
    }

    suspend fun getDownloadedFile(trackId: String): File? = withContext(Dispatchers.IO) {
        val idsToCheck = getAlternativeTrackIds(trackId)
        for (id in idsToCheck) {
            val entity = dao.getDownloadedTrackById(id)
            if (entity != null) {
                val file = File(entity.localFilePath)
                if (file.exists() && file.length() >= 10240L) {
                    return@withContext file
                } else {
                    dao.deleteDownloadedTrackById(id)
                }
            }
        }
        null
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
                }
            }

            // Verify minimum audio size (>10 KB)
            if (tempFile.length() < 10240L) {
                tempFile.delete()
                return@withContext Result.failure(
                    Exception("Downloaded audio file is too small or corrupt: ${tempFile.length()} bytes")
                )
            }

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

            val mimeType = if (ext == "m4a") "audio/mp4" else "audio/mpeg"
            val entity = DownloadedTrackEntity(
                id = track.id,
                title = track.title,
                artist = track.artist,
                album = track.album,
                artworkUrl = track.artworkUrl,
                localFilePath = finalFile.absolutePath,
                mimeType = mimeType,
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

            val pathKey = file.canonicalPath
            val sigKey = "${entity.title.trim().lowercase()}::${entity.artist.trim().lowercase()}"

            if (seenPaths.contains(pathKey) || seenSignatures.contains(sigKey)) {
                // Redundant duplicate entry in Room pointing to the same file or identical title/artist
                dao.deleteDownloadedTrackById(entity.id)
                continue
            }

            seenPaths.add(pathKey)
            seenSignatures.add(sigKey)
            deduplicated.add(entity)
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
        }
        stagingFile.length()
    }

    /**
     * Commits a completed chunked download:
     * 1. Validates that staging file exists and length >= 10240 bytes (10KB).
     * 2. Atomically renames .tmp file to final persistent file (with copy fallback).
     * 3. Validates final file integrity.
     * 4. Inserts/updates Room DownloadedTrackEntity.
     * 5. If Room write fails, rolls back the disk file to avoid orphaned files.
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

        val sanitizedId = sanitizeTrackId(trackId)
        val ext = if (entity.mimeType.contains("mp4", ignoreCase = true) || 
                      entity.mimeType.contains("m4a", ignoreCase = true) || 
                      entity.mimeType.contains("aac", ignoreCase = true)) "m4a" else "mp3"
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

        val verifiedEntity = entity.copy(
            localFilePath = finalFile.absolutePath,
            fileSize = finalFile.length(),
            mimeType = if (ext == "m4a") "audio/mp4" else "audio/mpeg",
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
