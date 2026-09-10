package com.stuxs.music.nativeplayer

import com.stuxs.music.nativeplayer.bridge.NativeChunkedDownloadManager
import com.stuxs.music.nativeplayer.data.DownloadedTrackEntity
import com.stuxs.music.nativeplayer.data.repository.NativeDownloadRepository
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.io.File
import java.util.Base64

class StuxsNativeDownloadStep5LifecycleTest {

    private lateinit var tempDir: File
    private lateinit var fakeDao: StuxsNativeDownloadRepositoryTest.FakeDownloadedTrackDao
    private lateinit var repository: NativeDownloadRepository
    private lateinit var downloadManager: NativeChunkedDownloadManager

    private fun createBase64(sizeBytes: Int, fill: Byte = 0x5A): String {
        val bytes = ByteArray(sizeBytes) { fill }
        return Base64.getEncoder().encodeToString(bytes)
    }

    @Before
    fun setUp() {
        tempDir = File(System.getProperty("java.io.tmpdir"), "stuxs_step5_test_${System.nanoTime()}").apply {
            mkdirs()
        }
        fakeDao = StuxsNativeDownloadRepositoryTest.FakeDownloadedTrackDao()
        repository = NativeDownloadRepository(
            context = null,
            customDao = fakeDao,
            customDownloadsDir = tempDir
        )
        downloadManager = NativeChunkedDownloadManager(repository)
    }

    @After
    fun tearDown() {
        tempDir.deleteRecursively()
    }

    @Test
    fun test1_CompletedNativeDownloadDetectionAndStatus() = runBlocking {
        val trackId = "track-lifecycle-1"
        val payload8k = createBase64(8192)

        // Staging
        val beginRes = downloadManager.beginDownload(trackId, "mp3")
        assertTrue("Begin must succeed", beginRes.success)

        val write1 = downloadManager.writeChunk(trackId, 0, payload8k, "mp3")
        assertTrue(write1.success)
        val write2 = downloadManager.writeChunk(trackId, 1, payload8k, "mp3")
        assertTrue(write2.success)

        val entity = DownloadedTrackEntity(
            id = trackId,
            title = "Step 5 Song",
            artist = "Artist 5",
            album = "Album 5",
            artworkUrl = "https://example.com/art5.jpg",
            localFilePath = "",
            mimeType = "audio/mpeg",
            fileSize = 0L,
            durationMs = 240000L,
            provider = "jiosaavn"
        )

        val commitRes = downloadManager.commitDownload(entity)
        assertTrue("Commit must succeed", commitRes.success)
        assertNotNull(commitRes.localFilePath)

        // 1. Detection
        assertTrue("isDownloaded must be true", downloadManager.isDownloadedBlocking(trackId))
        assertTrue("Repository isDownloaded must be true", repository.isDownloaded(trackId))

        // 2. Status API
        val status = downloadManager.getDownloadStatusBlocking(trackId)
        assertEquals("trackId must match", trackId, status.trackId)
        assertEquals("status must be downloaded", "downloaded", status.status)
        assertTrue("isVerified must be true", status.isVerified)
        assertEquals("fileSize must match disk bytes", 16384L, status.fileSize)
        assertEquals(commitRes.localFilePath, status.localFilePath)
        assertNull(status.error)
    }

    @Test
    fun test2_InterruptedDownloadCleanup() = runBlocking {
        val trackId = "track-lifecycle-interrupt"
        val payload = createBase64(4096)

        downloadManager.beginDownload(trackId, "mp3")
        downloadManager.writeChunk(trackId, 0, payload, "mp3")

        val stagingFile = File(tempDir, "${trackId}.stage.tmp")
        assertTrue("Staging file must exist during transfer", stagingFile.exists())
        assertEquals("status must report downloading while staging", "downloading", downloadManager.getDownloadStatusBlocking(trackId).status)

        // Abort transfer (e.g. network disconnect or user cancel)
        val abortRes = downloadManager.abortDownload(trackId)
        assertTrue("Abort must return true", abortRes.success)

        // Verify cleanup
        assertFalse("Staging file must be deleted", stagingFile.exists())
        assertFalse("isDownloaded must be false", downloadManager.isDownloadedBlocking(trackId))
        assertFalse("Room must not contain track", fakeDao.existsById(trackId))

        val statusAfter = downloadManager.getDownloadStatusBlocking(trackId)
        assertEquals("not_downloaded", statusAfter.status)
        assertFalse(statusAfter.isVerified)
    }

    @Test
    fun test3_DuplicateDownloadProtection() = runBlocking {
        val trackId = "track-lifecycle-dup"
        val payload10k = createBase64(10240)

        // Download first time
        downloadManager.beginDownload(trackId, "mp3")
        downloadManager.writeChunk(trackId, 0, payload10k, "mp3")
        val entity = DownloadedTrackEntity(
            id = trackId,
            title = "Original Song",
            artist = "Original Artist",
            album = null,
            artworkUrl = null,
            localFilePath = "",
            mimeType = "audio/mpeg",
            fileSize = 0L,
            durationMs = 180000L,
            provider = "jiosaavn"
        )
        val commitRes = downloadManager.commitDownload(entity)
        assertTrue(commitRes.success)
        val originalFile = File(commitRes.localFilePath!!)
        val originalLength = originalFile.length()

        // Attempt duplicate download with skipIfDownloaded = true
        val dupBegin = downloadManager.beginDownload(trackId, "mp3", skipIfDownloaded = true)
        assertTrue(dupBegin.success)
        assertTrue("Must report alreadyDownloaded", dupBegin.alreadyDownloaded)
        assertEquals("nextExpectedChunkIndex must be -1 when skipped", -1, dupBegin.nextExpectedChunkIndex)

        // Final file must be byte-for-byte unchanged
        assertTrue(originalFile.exists())
        assertEquals("File length must be unchanged", originalLength, originalFile.length())
        assertEquals("Room count must be exactly 1", 1, fakeDao.storage.size)
    }

    @Test
    fun test4_DeletionRemovesFileAndRoom() = runBlocking {
        val trackId = "track-lifecycle-delete"
        val payload = createBase64(12000)

        downloadManager.beginDownload(trackId, "mp3")
        downloadManager.writeChunk(trackId, 0, payload, "mp3")
        val entity = DownloadedTrackEntity(
            id = trackId,
            title = "To Delete",
            artist = "Artist",
            album = null,
            artworkUrl = null,
            localFilePath = "",
            mimeType = "audio/mpeg",
            fileSize = 0L,
            durationMs = 120000L,
            provider = "jiosaavn"
        )
        val commit = downloadManager.commitDownload(entity)
        val finalFile = File(commit.localFilePath!!)
        assertTrue("Final file must exist before delete", finalFile.exists())

        // Delete
        val removed = downloadManager.removeDownloadBlocking(trackId)
        assertTrue("removeDownload must return true", removed)

        // Verify disk and Room
        assertFalse("Final file must be deleted from disk", finalFile.exists())
        assertFalse("Room entity must be deleted", fakeDao.existsById(trackId))
        assertFalse("isDownloaded must be false", downloadManager.isDownloadedBlocking(trackId))

        val status = downloadManager.getDownloadStatusBlocking(trackId)
        assertEquals("not_downloaded", status.status)
        assertFalse(status.isVerified)
    }

    @Test
    fun test5_ReDownloadAfterDeletion() = runBlocking {
        val trackId = "track-lifecycle-redownload"
        val payload1 = createBase64(11000)

        // Pass 1: Download & verify
        downloadManager.beginDownload(trackId, "mp3")
        downloadManager.writeChunk(trackId, 0, payload1, "mp3")
        val entity1 = DownloadedTrackEntity(
            id = trackId,
            title = "First Pass",
            artist = "Artist",
            album = null,
            artworkUrl = null,
            localFilePath = "",
            mimeType = "audio/mpeg",
            fileSize = 0L,
            durationMs = 100000L,
            provider = "jiosaavn"
        )
        downloadManager.commitDownload(entity1)
        assertTrue(downloadManager.isDownloadedBlocking(trackId))

        // Pass 2: Delete
        downloadManager.removeDownloadBlocking(trackId)
        assertFalse(downloadManager.isDownloadedBlocking(trackId))

        // Pass 3: Re-download with different content
        val payload2 = createBase64(15000, fill = 0x77)
        val beginRes2 = downloadManager.beginDownload(trackId, "mp3")
        assertTrue("Re-download begin must succeed", beginRes2.success)
        assertFalse("Must not report alreadyDownloaded after deletion", beginRes2.alreadyDownloaded)

        val writeRes2 = downloadManager.writeChunk(trackId, 0, payload2, "mp3")
        assertTrue(writeRes2.success)

        val entity2 = entity1.copy(title = "Second Pass Clean")
        val commitRes2 = downloadManager.commitDownload(entity2)
        assertTrue("Re-download commit must succeed", commitRes2.success)

        val finalFile = File(commitRes2.localFilePath!!)
        assertTrue("Re-downloaded final file must exist", finalFile.exists())
        assertEquals(15000L, finalFile.length())
        assertTrue(downloadManager.isDownloadedBlocking(trackId))
        assertEquals("Second Pass Clean", fakeDao.getDownloadedTrackById(trackId)?.title)
    }

    @Test
    fun test6_RoomFileConsistencyAndSelfHealing() = runBlocking {
        val trackId = "track-lifecycle-heal"
        val payload = createBase64(14000)

        downloadManager.beginDownload(trackId, "mp3")
        downloadManager.writeChunk(trackId, 0, payload, "mp3")
        val entity = DownloadedTrackEntity(
            id = trackId,
            title = "Self Heal Song",
            artist = "Artist",
            album = null,
            artworkUrl = null,
            localFilePath = "",
            mimeType = "audio/mpeg",
            fileSize = 0L,
            durationMs = 120000L,
            provider = "jiosaavn"
        )
        val commit = downloadManager.commitDownload(entity)
        val finalFile = File(commit.localFilePath!!)
        assertTrue(finalFile.exists())

        // Simulate external disk corruption or file deletion
        finalFile.delete()
        assertFalse(finalFile.exists())

        // isDownloaded must detect missing file and return false despite Room record
        assertFalse("isDownloaded must be false when disk file is deleted", repository.isDownloaded(trackId))
        assertFalse(downloadManager.isDownloadedBlocking(trackId))

        // getDownloadedFile must trigger self-healing and purge stale Room record
        val healedFile = repository.getDownloadedFile(trackId)
        assertNull("getDownloadedFile should return null for missing file", healedFile)
        assertFalse("Stale Room entity must be deleted by self-healing", fakeDao.existsById(trackId))
    }

    @Test
    fun test7_NativeInventoryLookup() = runBlocking {
        // Download 3 tracks
        for (i in 1..3) {
            val trackId = "track-inventory-$i"
            val payload = createBase64(10240 + i * 1024)
            downloadManager.beginDownload(trackId, "mp3")
            downloadManager.writeChunk(trackId, 0, payload, "mp3")
            val entity = DownloadedTrackEntity(
                id = trackId,
                title = "Track $i",
                artist = "Artist $i",
                album = "Album $i",
                artworkUrl = "https://example.com/art$i.jpg",
                localFilePath = "",
                mimeType = "audio/mpeg",
                fileSize = 0L,
                durationMs = 150000L + i * 1000L,
                provider = "jiosaavn"
            )
            downloadManager.commitDownload(entity)
        }

        val allIds = downloadManager.getAllTrackIdsBlocking()
        assertEquals(3, allIds.size)
        assertTrue(allIds.contains("track-inventory-1"))
        assertTrue(allIds.contains("track-inventory-2"))
        assertTrue(allIds.contains("track-inventory-3"))

        val allTracks = downloadManager.getAllDownloadedTracksBlocking()
        assertEquals(3, allTracks.size)
        val t2 = allTracks.find { it.id == "track-inventory-2" }
        assertNotNull(t2)
        assertEquals("Track 2", t2?.title)
        assertEquals(12288L, t2?.fileSize)
        assertTrue(File(t2!!.localFilePath).exists())
    }
}
