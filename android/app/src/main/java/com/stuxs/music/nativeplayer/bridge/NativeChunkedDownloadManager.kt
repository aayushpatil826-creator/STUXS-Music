package com.stuxs.music.nativeplayer.bridge

import com.stuxs.music.nativeplayer.data.DownloadedTrackEntity
import com.stuxs.music.nativeplayer.data.repository.NativeDownloadRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import java.util.concurrent.ConcurrentHashMap

data class BeginResult(
    val success: Boolean,
    val trackId: String,
    val nextExpectedChunkIndex: Int = 0,
    val alreadyDownloaded: Boolean = false,
    val error: String? = null
)

data class ChunkWriteResult(
    val success: Boolean,
    val trackId: String,
    val acceptedChunkIndex: Int,
    val nextExpectedChunkIndex: Int,
    val bytesWritten: Long,
    val error: String? = null
)

data class CommitResult(
    val success: Boolean,
    val trackId: String,
    val localFilePath: String? = null,
    val fileSize: Long = 0L,
    val error: String? = null
)

data class AbortResult(
    val success: Boolean,
    val trackId: String,
    val error: String? = null
)

data class NativeDownloadStatus(
    val trackId: String,
    val status: String,
    val isVerified: Boolean,
    val expectedChunkIndex: Int = 0,
    val fileSize: Long = 0L,
    val localFilePath: String? = null,
    val error: String? = null
)

class NativeChunkedDownloadManager(
    private val repository: NativeDownloadRepository
) {
    companion object {
        const val MAX_CHUNK_SIZE_BYTES = 256 * 1024 // 262,144 bytes (256 KB)

        fun decodeBase64(data: String): ByteArray {
            val cleanData = if (data.contains(",")) data.substringAfter(",") else data
            val trimmed = cleanData.trim().replace("\n", "").replace("\r", "")
            try {
                return java.util.Base64.getDecoder().decode(trimmed)
            } catch (e: IllegalArgumentException) {
                // Attempt URL-safe decode
                try {
                    return java.util.Base64.getUrlDecoder().decode(trimmed)
                } catch (ignored: Exception) {}
                // If on Android runtime, attempt android.util.Base64 via reflection
                try {
                    val clazz = Class.forName("android.util.Base64")
                    val method = clazz.getMethod("decode", String::class.java, Int::class.javaPrimitiveType)
                    return method.invoke(null, trimmed, 0) as ByteArray
                } catch (ignored: Throwable) {}
                throw IllegalArgumentException("Invalid Base64 payload: ${e.message}", e)
            }
        }
    }

    private val expectedChunkIndexMap = ConcurrentHashMap<String, Int>()
    private val stagingMetadataMap = ConcurrentHashMap<String, DownloadedTrackEntity>()

    suspend fun beginDownload(
        trackId: String,
        extension: String = "mp3",
        metadata: DownloadedTrackEntity? = null,
        skipIfDownloaded: Boolean = false
    ): BeginResult = withContext(Dispatchers.IO) {
        if (trackId.isBlank()) {
            return@withContext BeginResult(
                success = false,
                trackId = trackId,
                nextExpectedChunkIndex = 0,
                error = "trackId cannot be blank"
            )
        }

        if (skipIfDownloaded && repository.isDownloaded(trackId)) {
            return@withContext BeginResult(
                success = true,
                trackId = trackId,
                nextExpectedChunkIndex = -1,
                alreadyDownloaded = true
            )
        }

        try {
            repository.beginChunkedDownload(trackId, extension)
            expectedChunkIndexMap[trackId] = 0
            if (metadata != null) {
                stagingMetadataMap[trackId] = metadata
            } else {
                stagingMetadataMap.remove(trackId)
            }
            BeginResult(
                success = true,
                trackId = trackId,
                nextExpectedChunkIndex = 0
            )
        } catch (e: Exception) {
            expectedChunkIndexMap.remove(trackId)
            stagingMetadataMap.remove(trackId)
            BeginResult(
                success = false,
                trackId = trackId,
                nextExpectedChunkIndex = 0,
                error = "Failed to begin staging: ${e.message}"
            )
        }
    }

    suspend fun writeChunk(
        trackId: String,
        chunkIndex: Int,
        base64Data: String,
        extension: String = "mp3"
    ): ChunkWriteResult = withContext(Dispatchers.IO) {
        if (trackId.isBlank()) {
            return@withContext ChunkWriteResult(
                success = false,
                trackId = trackId,
                acceptedChunkIndex = -1,
                nextExpectedChunkIndex = 0,
                bytesWritten = 0L,
                error = "trackId cannot be blank"
            )
        }

        // Validate sequence order
        val expectedIndex = expectedChunkIndexMap[trackId] ?: 0
        if (chunkIndex != expectedIndex) {
            val reason = when {
                chunkIndex < expectedIndex -> "Duplicate chunk: received $chunkIndex, expected $expectedIndex for trackId $trackId"
                expectedIndex == 0 -> "First chunk must be index 0: received $chunkIndex for trackId $trackId"
                else -> "Out-of-order or skipped chunk: received $chunkIndex, expected $expectedIndex for trackId $trackId"
            }
            return@withContext ChunkWriteResult(
                success = false,
                trackId = trackId,
                acceptedChunkIndex = -1,
                nextExpectedChunkIndex = expectedIndex,
                bytesWritten = 0L,
                error = reason
            )
        }

        // Decode Base64 safely
        val binaryData: ByteArray
        try {
            binaryData = decodeBase64(base64Data)
        } catch (e: Exception) {
            return@withContext ChunkWriteResult(
                success = false,
                trackId = trackId,
                acceptedChunkIndex = -1,
                nextExpectedChunkIndex = expectedIndex,
                bytesWritten = 0L,
                error = "Invalid Base64 payload: ${e.message}"
            )
        }

        // Validate binary chunk size <= 256 KB
        if (binaryData.size > MAX_CHUNK_SIZE_BYTES) {
            return@withContext ChunkWriteResult(
                success = false,
                trackId = trackId,
                acceptedChunkIndex = -1,
                nextExpectedChunkIndex = expectedIndex,
                bytesWritten = 0L,
                error = "Chunk binary size (${binaryData.size} bytes) exceeds maximum 256 KB ($MAX_CHUNK_SIZE_BYTES bytes)"
            )
        }

        try {
            // If first chunk (0), initialize staging file in repository
            if (chunkIndex == 0) {
                repository.beginChunkedDownload(trackId, extension)
            }

            // Append chunk to staging file
            val totalStagedLength = repository.appendChunk(trackId, binaryData)

            // Advance sequence
            val nextIndex = chunkIndex + 1
            expectedChunkIndexMap[trackId] = nextIndex

            ChunkWriteResult(
                success = true,
                trackId = trackId,
                acceptedChunkIndex = chunkIndex,
                nextExpectedChunkIndex = nextIndex,
                bytesWritten = totalStagedLength
            )
        } catch (e: Exception) {
            ChunkWriteResult(
                success = false,
                trackId = trackId,
                acceptedChunkIndex = -1,
                nextExpectedChunkIndex = expectedIndex,
                bytesWritten = 0L,
                error = "Failed to write chunk: ${e.message}"
            )
        }
    }

    suspend fun commitDownload(
        entity: DownloadedTrackEntity
    ): CommitResult = withContext(Dispatchers.IO) {
        val trackId = entity.id
        try {
            val stagedMetadata = stagingMetadataMap[trackId]
            val finalEntity = if (stagedMetadata != null) {
                entity.copy(
                    title = if (entity.title != "Unknown Title") entity.title else stagedMetadata.title,
                    artist = if (entity.artist != "Unknown Artist") entity.artist else stagedMetadata.artist,
                    album = entity.album ?: stagedMetadata.album,
                    artworkUrl = entity.artworkUrl ?: stagedMetadata.artworkUrl,
                    mimeType = if (entity.mimeType.isNotBlank() && entity.mimeType != "audio/mpeg") entity.mimeType else stagedMetadata.mimeType,
                    durationMs = if (entity.durationMs > 0) entity.durationMs else stagedMetadata.durationMs,
                    provider = if (entity.provider != "unknown") entity.provider else stagedMetadata.provider,
                    downloadedAt = if (entity.downloadedAt > 0) entity.downloadedAt else stagedMetadata.downloadedAt
                )
            } else {
                entity
            }

            val result = repository.commitChunkedDownload(finalEntity)
            expectedChunkIndexMap.remove(trackId)
            stagingMetadataMap.remove(trackId)
            if (result.isSuccess) {
                val committed = result.getOrNull()!!
                CommitResult(
                    success = true,
                    trackId = trackId,
                    localFilePath = committed.localFilePath,
                    fileSize = committed.fileSize
                )
            } else {
                CommitResult(
                    success = false,
                    trackId = trackId,
                    error = result.exceptionOrNull()?.message ?: "Commit failed"
                )
            }
        } catch (e: Exception) {
            expectedChunkIndexMap.remove(trackId)
            stagingMetadataMap.remove(trackId)
            CommitResult(
                success = false,
                trackId = trackId,
                error = e.message ?: "Commit failed"
            )
        }
    }

    suspend fun abortDownload(trackId: String): AbortResult = withContext(Dispatchers.IO) {
        try {
            repository.abortChunkedDownload(trackId)
            expectedChunkIndexMap.remove(trackId)
            stagingMetadataMap.remove(trackId)
            AbortResult(success = true, trackId = trackId)
        } catch (e: Exception) {
            expectedChunkIndexMap.remove(trackId)
            stagingMetadataMap.remove(trackId)
            AbortResult(success = false, trackId = trackId, error = e.message)
        }
    }

    fun getExpectedChunkIndex(trackId: String): Int {
        return expectedChunkIndexMap[trackId] ?: 0
    }

    fun isTrackStaging(trackId: String): Boolean {
        return expectedChunkIndexMap.containsKey(trackId)
    }

    fun getStagedMetadata(trackId: String): DownloadedTrackEntity? {
        return stagingMetadataMap[trackId]
    }

    // Java-friendly synchronous wrappers (to be called from background ExecutorService)
    fun beginDownloadBlocking(
        trackId: String,
        extension: String = "mp3",
        metadata: DownloadedTrackEntity? = null,
        skipIfDownloaded: Boolean = false
    ): BeginResult = runBlocking(Dispatchers.IO) {
        beginDownload(trackId, extension, metadata, skipIfDownloaded)
    }

    fun writeChunkBlocking(
        trackId: String,
        chunkIndex: Int,
        base64Data: String,
        extension: String = "mp3"
    ): ChunkWriteResult = runBlocking(Dispatchers.IO) {
        writeChunk(trackId, chunkIndex, base64Data, extension)
    }

    fun commitDownloadBlocking(
        entity: DownloadedTrackEntity
    ): CommitResult = runBlocking(Dispatchers.IO) {
        commitDownload(entity)
    }

    fun abortDownloadBlocking(
        trackId: String
    ): AbortResult = runBlocking(Dispatchers.IO) {
        abortDownload(trackId)
    }

    fun getAllTrackIdsBlocking(): List<String> = runBlocking(Dispatchers.IO) {
        repository.getAllTrackIds()
    }

    fun isDownloadedBlocking(trackId: String): Boolean = runBlocking(Dispatchers.IO) {
        repository.isDownloaded(trackId)
    }

    fun removeDownloadBlocking(trackId: String): Boolean = runBlocking(Dispatchers.IO) {
        expectedChunkIndexMap.remove(trackId)
        stagingMetadataMap.remove(trackId)
        repository.removeDownload(trackId)
    }

    fun getAllDownloadedTracksBlocking(): List<DownloadedTrackEntity> = runBlocking(Dispatchers.IO) {
        repository.getAllDownloadedTracks()
    }

    fun getDownloadStatusBlocking(trackId: String): NativeDownloadStatus = runBlocking(Dispatchers.IO) {
        if (trackId.isBlank()) {
            return@runBlocking NativeDownloadStatus(
                trackId = trackId,
                status = "not_downloaded",
                isVerified = false,
                expectedChunkIndex = 0,
                error = "trackId cannot be blank"
            )
        }
        if (repository.isDownloaded(trackId)) {
            val entity = repository.getAllDownloadedTracks().find { it.id == trackId }
            return@runBlocking NativeDownloadStatus(
                trackId = trackId,
                status = "downloaded",
                isVerified = true,
                expectedChunkIndex = 0,
                fileSize = entity?.fileSize ?: 0L,
                localFilePath = entity?.localFilePath
            )
        }
        if (isTrackStaging(trackId)) {
            return@runBlocking NativeDownloadStatus(
                trackId = trackId,
                status = "downloading",
                isVerified = false,
                expectedChunkIndex = getExpectedChunkIndex(trackId)
            )
        }
        NativeDownloadStatus(
            trackId = trackId,
            status = "not_downloaded",
            isVerified = false,
            expectedChunkIndex = 0
        )
    }

    fun purgeOrphanFilesBlocking(olderThanMs: Long = 10 * 60 * 1000L): Int = runBlocking(Dispatchers.IO) {
        repository.purgeOrphanFiles(olderThanMs)
    }
}
