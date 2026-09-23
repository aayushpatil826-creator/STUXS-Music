package com.stuxs.music.nativeplayer

import com.stuxs.music.nativeplayer.data.DownloadedTrackDao
import com.stuxs.music.nativeplayer.data.DownloadedTrackEntity
import com.stuxs.music.nativeplayer.data.repository.NativeDownloadRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.io.File
import java.util.concurrent.ConcurrentHashMap

class StuxsNativeDownloadRepositoryTest {

    private lateinit var tempDir: File
    private lateinit var fakeDao: FakeDownloadedTrackDao
    private lateinit var repository: NativeDownloadRepository

    class FakeDownloadedTrackDao : DownloadedTrackDao {
        val storage = ConcurrentHashMap<String, DownloadedTrackEntity>()
        var shouldFailInsert = false

        override fun getAllDownloadedTracks(): Flow<List<DownloadedTrackEntity>> =
            flowOf(storage.values.toList())

        override suspend fun getAllDownloadedTracksSync(): List<DownloadedTrackEntity> =
            storage.values.toList()

        override suspend fun getDownloadedTrackById(id: String): DownloadedTrackEntity? =
            storage[id]

        override suspend fun insertDownloadedTrack(track: DownloadedTrackEntity) {
            if (shouldFailInsert) {
                throw RuntimeException("Simulated SQLite write error")
            }
            storage[track.id] = track
        }

        override suspend fun deleteDownloadedTrackById(id: String): Int =
            if (storage.remove(id) != null) 1 else 0

        override suspend fun isTrackDownloaded(id: String): Int =
            if (storage.containsKey(id)) 1 else 0

        override suspend fun getAllTrackIds(): List<String> =
            storage.keys().toList()

        override suspend fun existsById(id: String): Boolean =
            storage.containsKey(id)

        override suspend fun getDownloadedTrackByTitleAndArtist(title: String, artist: String): DownloadedTrackEntity? =
            storage.values.firstOrNull { it.title.equals(title, ignoreCase = true) && it.artist.equals(artist, ignoreCase = true) }

        override suspend fun getDownloadedTrackByFilePath(filePath: String): DownloadedTrackEntity? =
            storage.values.firstOrNull { it.localFilePath == filePath }
    }

    @Before
    fun setUp() {
        tempDir = File(System.getProperty("java.io.tmpdir"), "stuxs_test_downloads_${System.nanoTime()}").apply {
            mkdirs()
        }
        fakeDao = FakeDownloadedTrackDao()
        repository = NativeDownloadRepository(
            context = null,
            customDao = fakeDao,
            customDownloadsDir = tempDir
        )
    }

    @After
    fun tearDown() {
        tempDir.deleteRecursively()
    }

    @Test
    fun testIncompleteChunkCleanupOnRestart() = runBlocking {
        val trackId = "test-track-incomplete"
        
        // Step 1: Start staging and append initial 1KB
        val stage1 = repository.beginChunkedDownload(trackId, "mp3")
        assertTrue("Staging file must exist", stage1.exists())
        repository.appendChunk(trackId, ByteArray(1024) { 1 })
        assertEquals("Staging file must have 1024 bytes", 1024L, stage1.length())

        // Step 2: Restart download for the same trackId (e.g. after interruption)
        val stage2 = repository.beginChunkedDownload(trackId, "mp3")
        assertTrue("New staging file must exist", stage2.exists())
        assertEquals("Staging file must be reset to 0 bytes", 0L, stage2.length())
    }

    @Test
    fun testAbortCleanup() = runBlocking {
        val trackId = "test-track-abort"
        
        repository.beginChunkedDownload(trackId, "mp3")
        repository.appendChunk(trackId, ByteArray(5000) { 2 })

        val stagingFile = File(tempDir, "${trackId}.stage.tmp")
        assertTrue("Staging file must exist before abort", stagingFile.exists())

        val aborted = repository.abortChunkedDownload(trackId)
        assertTrue("Abort should return true", aborted)
        assertFalse("Staging file must be deleted after abort", stagingFile.exists())
        assertFalse("No Room record should exist", fakeDao.existsById(trackId))
    }

    @Test
    fun testFileSmallerThan10KBRejected() = runBlocking {
        val trackId = "test-track-small"
        
        repository.beginChunkedDownload(trackId, "mp3")
        // Append only 5KB (< 10240 bytes)
        repository.appendChunk(trackId, ByteArray(5120) { 3 })

        val entity = DownloadedTrackEntity(
            id = trackId,
            title = "Small Track",
            artist = "Artist",
            album = "Album",
            artworkUrl = null,
            localFilePath = "",
            mimeType = "audio/mpeg",
            fileSize = 0L,
            durationMs = 180000L,
            provider = "jiosaavn"
        )

        val result = repository.commitChunkedDownload(entity)
        assertTrue("Commit must fail when size < 10KB", result.isFailure)
        assertTrue(
            "Exception message must mention size or too small",
            result.exceptionOrNull()?.message?.contains("too small", ignoreCase = true) == true
        )

        val stagingFile = File(tempDir, "${trackId}.stage.tmp")
        assertFalse("Incomplete/undersized staging file must be cleaned up", stagingFile.exists())
        assertFalse("Room must not contain undersized track", fakeDao.existsById(trackId))
    }

    @Test
    fun testValidChunksProduceCorrectFinalFile() = runBlocking {
        val trackId = "test-track-valid"
        
        repository.beginChunkedDownload(trackId, "mp3")
        // Append two 6KB chunks (total 12KB >= 10KB)
        repository.appendChunk(trackId, ByteArray(6144) { 4 })
        repository.appendChunk(trackId, ByteArray(6144) { 5 })

        val entity = DownloadedTrackEntity(
            id = trackId,
            title = "Valid Track",
            artist = "Great Artist",
            album = "Hit Album",
            artworkUrl = "https://example.com/art.jpg",
            localFilePath = "",
            mimeType = "audio/mpeg",
            fileSize = 0L,
            durationMs = 210000L,
            provider = "jiosaavn"
        )

        val result = repository.commitChunkedDownload(entity)
        assertTrue("Commit must succeed for >= 10KB", result.isSuccess)

        val committed = result.getOrNull()!!
        val finalFile = File(committed.localFilePath)
        assertTrue("Final file must exist", finalFile.exists())
        assertEquals("Final file size must be 12288 bytes", 12288L, finalFile.length())
        assertTrue("Final file path must end with .mp3", finalFile.name.endsWith(".mp3"))

        val stagingFile = File(tempDir, "${trackId}.stage.tmp")
        assertFalse("Staging file must no longer exist after commit", stagingFile.exists())
    }

    @Test
    fun testAtomicCommitCreatesCorrectRoomRecord() = runBlocking {
        val trackId = "test-track-room"
        
        val m4aBytes = ByteArray(15000) { 6 }.apply {
            this[4] = 'f'.code.toByte()
            this[5] = 't'.code.toByte()
            this[6] = 'y'.code.toByte()
            this[7] = 'p'.code.toByte()
        }
        repository.appendChunk(trackId, m4aBytes)

        val entity = DownloadedTrackEntity(
            id = trackId,
            title = "Room Track",
            artist = "Room Artist",
            album = "Room Album",
            artworkUrl = "https://example.com/art.jpg",
            localFilePath = "",
            mimeType = "audio/mp4",
            fileSize = 0L,
            durationMs = 195000L,
            provider = "jiosaavn"
        )

        val result = repository.commitChunkedDownload(entity)
        assertTrue("Commit should succeed", result.isSuccess)

        // Verify Room records
        assertTrue("existsById must return true", repository.existsById(trackId))
        assertTrue("getAllTrackIds must contain trackId", repository.getAllTrackIds().contains(trackId))

        val roomRecord = fakeDao.getDownloadedTrackById(trackId)
        assertNotNull("Room record must exist", roomRecord)
        assertEquals("Title must match", "Room Track", roomRecord!!.title)
        assertEquals("MimeType must match", "audio/mp4", roomRecord.mimeType)
        assertEquals("FileSize must match actual disk size", 15000L, roomRecord.fileSize)
        assertTrue("Local file path must point to final file", File(roomRecord.localFilePath).exists())
    }

    @Test
    fun testRepeatedCommitIsSafeAndIdempotent() = runBlocking {
        val trackId = "test-track-idempotent"
        
        // Pass 1: Commit initial 12KB file
        repository.beginChunkedDownload(trackId, "mp3")
        repository.appendChunk(trackId, ByteArray(12000) { 7 })
        val entity1 = DownloadedTrackEntity(
            id = trackId,
            title = "Version 1",
            artist = "Artist",
            album = null,
            artworkUrl = null,
            localFilePath = "",
            mimeType = "audio/mpeg",
            fileSize = 0L,
            durationMs = 120000L,
            provider = "jiosaavn"
        )
        val res1 = repository.commitChunkedDownload(entity1)
        assertTrue("Pass 1 should succeed", res1.isSuccess)
        assertEquals(12000L, res1.getOrNull()!!.fileSize)

        // Pass 2: Overwrite with newer 16KB file (same trackId)
        repository.beginChunkedDownload(trackId, "mp3")
        repository.appendChunk(trackId, ByteArray(16000) { 8 })
        val entity2 = entity1.copy(title = "Version 2")
        val res2 = repository.commitChunkedDownload(entity2)
        assertTrue("Pass 2 should succeed idempotently", res2.isSuccess)

        val updatedRecord = fakeDao.getDownloadedTrackById(trackId)
        assertNotNull(updatedRecord)
        assertEquals("Version 2", updatedRecord!!.title)
        assertEquals(16000L, updatedRecord.fileSize)
        assertEquals(1, fakeDao.storage.size) // No duplicate rows in Room
    }

    @Test
    fun testFailureDuringRoomCommitRollsBackDiskFile() = runBlocking {
        val trackId = "test-track-fail-room"
        
        repository.beginChunkedDownload(trackId, "mp3")
        repository.appendChunk(trackId, ByteArray(12000) { 9 })

        // Force fake Room to throw an exception on insert
        fakeDao.shouldFailInsert = true

        val entity = DownloadedTrackEntity(
            id = trackId,
            title = "Failing Track",
            artist = "Artist",
            album = null,
            artworkUrl = null,
            localFilePath = "",
            mimeType = "audio/mpeg",
            fileSize = 0L,
            durationMs = 100000L,
            provider = "jiosaavn"
        )

        val result = repository.commitChunkedDownload(entity)
        assertTrue("Commit must fail if Room insert throws", result.isFailure)

        // Verify rollback: disk file must be deleted so no orphaned file is left
        val finalFile = File(tempDir, "${trackId}.mp3")
        assertFalse("Final file must be deleted if Room write fails", finalFile.exists())
        assertFalse("Room must not have record", fakeDao.existsById(trackId))
    }
}
