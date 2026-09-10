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

class StuxsNativeChunkedDownloadManagerTest {

    private lateinit var tempDir: File
    private lateinit var fakeDao: StuxsNativeDownloadRepositoryTest.FakeDownloadedTrackDao
    private lateinit var repository: NativeDownloadRepository
    private lateinit var downloadManager: NativeChunkedDownloadManager

    private fun createBase64(sizeBytes: Int, fill: Byte = 0x42): String {
        val bytes = ByteArray(sizeBytes) { fill }
        return Base64.getEncoder().encodeToString(bytes)
    }

    @Before
    fun setUp() {
        tempDir = File(System.getProperty("java.io.tmpdir"), "stuxs_manager_test_${System.nanoTime()}").apply {
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
    fun testFirstChunkMustBeIndex0() = runBlocking {
        val trackId = "track-first-check"
        val payload = createBase64(1024)

        // Attempt sending chunkIndex = 1 as the initial chunk
        val res = downloadManager.writeChunk(trackId, 1, payload, "mp3")
        assertFalse("Chunk 1 as first chunk must fail", res.success)
        assertTrue("Error must mention first chunk must be index 0", res.error?.contains("First chunk must be index 0") == true)
        assertEquals("Expected chunk index should remain 0", 0, downloadManager.getExpectedChunkIndex(trackId))
    }

    @Test
    fun testSequentialChunks012Succeed() = runBlocking {
        val trackId = "track-seq-check"
        val payload4K = createBase64(4096)

        // Chunk 0
        val res0 = downloadManager.writeChunk(trackId, 0, payload4K, "mp3")
        assertTrue("Chunk 0 must succeed", res0.success)
        assertEquals(0, res0.acceptedChunkIndex)
        assertEquals(1, res0.nextExpectedChunkIndex)
        assertEquals(4096L, res0.bytesWritten)

        // Chunk 1
        val res1 = downloadManager.writeChunk(trackId, 1, payload4K, "mp3")
        assertTrue("Chunk 1 must succeed", res1.success)
        assertEquals(1, res1.acceptedChunkIndex)
        assertEquals(2, res1.nextExpectedChunkIndex)
        assertEquals(8192L, res1.bytesWritten)

        // Chunk 2
        val res2 = downloadManager.writeChunk(trackId, 2, payload4K, "mp3")
        assertTrue("Chunk 2 must succeed", res2.success)
        assertEquals(2, res2.acceptedChunkIndex)
        assertEquals(3, res2.nextExpectedChunkIndex)
        assertEquals(12288L, res2.bytesWritten)
    }

    @Test
    fun testDuplicateChunkRejected() = runBlocking {
        val trackId = "track-dup-check"
        val payload = createBase64(2048)

        val res0 = downloadManager.writeChunk(trackId, 0, payload, "mp3")
        assertTrue("Chunk 0 must succeed", res0.success)

        // Attempt resending chunk 0
        val resDup = downloadManager.writeChunk(trackId, 0, payload, "mp3")
        assertFalse("Duplicate chunk 0 must be rejected", resDup.success)
        assertTrue("Error must mention duplicate chunk", resDup.error?.contains("Duplicate chunk") == true)
        assertEquals("Expected chunk index must still be 1", 1, downloadManager.getExpectedChunkIndex(trackId))
    }

    @Test
    fun testSkippedChunkRejected() = runBlocking {
        val trackId = "track-skip-check"
        val payload = createBase64(2048)

        val res0 = downloadManager.writeChunk(trackId, 0, payload, "mp3")
        assertTrue("Chunk 0 must succeed", res0.success)

        // Attempt sending chunk 2, skipping chunk 1
        val resSkip = downloadManager.writeChunk(trackId, 2, payload, "mp3")
        assertFalse("Skipped chunk must be rejected", resSkip.success)
        assertTrue("Error must mention skipped or out-of-order", resSkip.error?.contains("Out-of-order or skipped chunk") == true)
        assertEquals("Expected chunk index must still be 1", 1, downloadManager.getExpectedChunkIndex(trackId))
    }

    @Test
    fun testOutOfOrderChunkRejected() = runBlocking {
        val trackId = "track-order-check"
        val payload = createBase64(2048)

        downloadManager.writeChunk(trackId, 0, payload, "mp3")
        downloadManager.writeChunk(trackId, 1, payload, "mp3")

        // Send past chunk (0)
        val resPast = downloadManager.writeChunk(trackId, 0, payload, "mp3")
        assertFalse("Past chunk must be rejected", resPast.success)

        // Send far future chunk (99)
        val resFuture = downloadManager.writeChunk(trackId, 99, payload, "mp3")
        assertFalse("Far future chunk must be rejected", resFuture.success)
        assertEquals("Expected chunk index must remain 2", 2, downloadManager.getExpectedChunkIndex(trackId))
    }

    @Test
    fun testPayloadGreaterThan256KBRejected() = runBlocking {
        val trackId = "track-large-check"
        // 256KB = 262144 bytes; 262145 is over the limit
        val oversizedPayload = createBase64(256 * 1024 + 1)

        val res = downloadManager.writeChunk(trackId, 0, oversizedPayload, "mp3")
        assertFalse("Oversized payload > 256KB must be rejected", res.success)
        assertTrue("Error must mention 256 KB limit", res.error?.contains("exceeds maximum 256 KB") == true)
    }

    @Test
    fun testInvalidBase64Rejected() = runBlocking {
        val trackId = "track-bad-base64"
        val badPayload = "This is not valid base64 payload @#%^&*!"

        val res = downloadManager.writeChunk(trackId, 0, badPayload, "mp3")
        assertFalse("Invalid Base64 payload must be rejected", res.success)
        assertTrue("Error must mention Invalid Base64 payload", res.error?.contains("Invalid Base64 payload") == true)
    }

    @Test
    fun testAbortResetsSequenceState() = runBlocking {
        val trackId = "track-abort-check"
        val payload = createBase64(2048)

        downloadManager.writeChunk(trackId, 0, payload, "mp3")
        downloadManager.writeChunk(trackId, 1, payload, "mp3")
        assertEquals(2, downloadManager.getExpectedChunkIndex(trackId))
        assertTrue(downloadManager.isTrackStaging(trackId))

        val abortRes = downloadManager.abortDownload(trackId)
        assertTrue("Abort must succeed", abortRes.success)
        assertEquals("Expected chunk index must reset to 0", 0, downloadManager.getExpectedChunkIndex(trackId))
        assertFalse("Track should no longer be staging", downloadManager.isTrackStaging(trackId))

        // New chunk 0 must now succeed
        val resNew0 = downloadManager.writeChunk(trackId, 0, payload, "mp3")
        assertTrue("Chunk 0 must succeed after abort", resNew0.success)
    }

    @Test
    fun testSuccessfulCommitResetsSequenceState() = runBlocking {
        val trackId = "track-commit-check"
        // Write 3 chunks of 4KB (total 12KB >= 10KB minimum)
        val payload4K = createBase64(4096)
        downloadManager.writeChunk(trackId, 0, payload4K, "mp3")
        downloadManager.writeChunk(trackId, 1, payload4K, "mp3")
        downloadManager.writeChunk(trackId, 2, payload4K, "mp3")

        val entity = DownloadedTrackEntity(
            id = trackId,
            title = "Commit Title",
            artist = "Commit Artist",
            album = "Album",
            artworkUrl = null,
            localFilePath = "",
            mimeType = "audio/mpeg",
            fileSize = 0L,
            durationMs = 150000L,
            provider = "jiosaavn"
        )

        val commitRes = downloadManager.commitDownload(entity)
        assertTrue("Commit should succeed", commitRes.success)
        assertEquals("Expected chunk index must reset to 0", 0, downloadManager.getExpectedChunkIndex(trackId))
        assertFalse("Track should no longer be in staging", downloadManager.isTrackStaging(trackId))
        assertTrue("Room must contain track", fakeDao.existsById(trackId))
    }

    @Test
    fun testMultipleTrackIdsMaintainIndependentChunkSequences() = runBlocking {
        val trackA = "track-independent-A"
        val trackB = "track-independent-B"
        val payload = createBase64(2048)

        // Chunk 0 for A
        val resA0 = downloadManager.writeChunk(trackA, 0, payload, "mp3")
        assertTrue("A0 must succeed", resA0.success)
        assertEquals(1, downloadManager.getExpectedChunkIndex(trackA))
        assertEquals(0, downloadManager.getExpectedChunkIndex(trackB))

        // Chunk 0 for B
        val resB0 = downloadManager.writeChunk(trackB, 0, payload, "mp3")
        assertTrue("B0 must succeed", resB0.success)
        assertEquals(1, downloadManager.getExpectedChunkIndex(trackA))
        assertEquals(1, downloadManager.getExpectedChunkIndex(trackB))

        // Chunk 1 for A
        val resA1 = downloadManager.writeChunk(trackA, 1, payload, "mp3")
        assertTrue("A1 must succeed", resA1.success)
        assertEquals(2, downloadManager.getExpectedChunkIndex(trackA))
        assertEquals(1, downloadManager.getExpectedChunkIndex(trackB))

        // Chunk 1 for B
        val resB1 = downloadManager.writeChunk(trackB, 1, payload, "mp3")
        assertTrue("B1 must succeed", resB1.success)
        assertEquals(2, downloadManager.getExpectedChunkIndex(trackA))
        assertEquals(2, downloadManager.getExpectedChunkIndex(trackB))
    }

    @Test
    fun testBeginTransferInitializesSessionAndMetadata() = runBlocking {
        val trackId = "track-begin-test"
        val metadata = DownloadedTrackEntity(
            id = trackId,
            title = "Begin Title",
            artist = "Begin Artist",
            album = "Begin Album",
            artworkUrl = "https://example.com/art.jpg",
            localFilePath = "",
            mimeType = "audio/mpeg",
            fileSize = 0L,
            durationMs = 180000L,
            provider = "jiosaavn"
        )

        val beginRes = downloadManager.beginDownload(trackId, "mp3", metadata)
        assertTrue("beginDownload must succeed", beginRes.success)
        assertEquals(trackId, beginRes.trackId)
        assertEquals(0, beginRes.nextExpectedChunkIndex)
        assertFalse(beginRes.alreadyDownloaded)

        // Staged metadata must be retrievable
        val staged = downloadManager.getStagedMetadata(trackId)
        assertNotNull("Staged metadata must be cached", staged)
        assertEquals("Begin Title", staged?.title)
        assertEquals(0, downloadManager.getExpectedChunkIndex(trackId))
        assertTrue(downloadManager.isTrackStaging(trackId))
    }

    @Test
    fun testBeginTransferSkipsIfAlreadyDownloaded() = runBlocking {
        val trackId = "track-already-downloaded"
        // First commit valid track
        val payload4K = createBase64(4096)
        downloadManager.writeChunk(trackId, 0, payload4K, "mp3")
        downloadManager.writeChunk(trackId, 1, payload4K, "mp3")
        downloadManager.writeChunk(trackId, 2, payload4K, "mp3")

        val entity = DownloadedTrackEntity(
            id = trackId,
            title = "Existing Track",
            artist = "Existing Artist",
            album = "Album",
            artworkUrl = null,
            localFilePath = "",
            mimeType = "audio/mpeg",
            fileSize = 0L,
            durationMs = 120000L,
            provider = "jiosaavn"
        )
        val commitRes = downloadManager.commitDownload(entity)
        assertTrue("Pre-commit must succeed", commitRes.success)

        // Now call beginDownload with skipIfDownloaded = true
        val beginRes = downloadManager.beginDownload(trackId, "mp3", skipIfDownloaded = true)
        assertTrue("beginDownload must return success=true", beginRes.success)
        assertTrue("alreadyDownloaded must be true", beginRes.alreadyDownloaded)
        assertEquals(-1, beginRes.nextExpectedChunkIndex)
    }

    @Test
    fun testCommitAfterIncompleteTransferFailsAndCleansUp() = runBlocking {
        val trackId = "track-incomplete-commit"
        // Transfer only 1 chunk of 2KB (< 10KB minimum)
        downloadManager.beginDownload(trackId, "mp3")
        downloadManager.writeChunk(trackId, 0, createBase64(2048), "mp3")

        val entity = DownloadedTrackEntity(
            id = trackId,
            title = "Incomplete Track",
            artist = "Incomplete Artist",
            album = null,
            artworkUrl = null,
            localFilePath = "",
            mimeType = "audio/mpeg",
            fileSize = 0L,
            durationMs = 60000L,
            provider = "jiosaavn"
        )

        val commitRes = downloadManager.commitDownload(entity)
        assertFalse("Commit of incomplete file (<10KB) must fail", commitRes.success)
        assertTrue("Error message must indicate file too small", commitRes.error?.contains("too small") == true)
        assertFalse("Room record must NOT exist for incomplete transfer", fakeDao.existsById(trackId))
        assertFalse("Track must no longer be staging", downloadManager.isTrackStaging(trackId))
    }

    @Test
    fun testMultipleChunksReconstructExactOriginalBytes() = runBlocking {
        val trackId = "track-exact-byte-reconstruct"
        
        // Generate known 64 KB byte array with non-trivial pattern
        val totalSize = 65536 // 64 KB
        val originalBytes = ByteArray(totalSize) { i ->
            ((i * 37 + 19) xor (i ushr 3) and 0xFF).toByte()
        }

        // Split into 4 chunks of 16 KB each (16384 bytes)
        val chunkSize = 16384
        val chunkCount = totalSize / chunkSize

        downloadManager.beginDownload(trackId, "mp3")

        for (chunkIdx in 0 until chunkCount) {
            val chunkBytes = originalBytes.copyOfRange(chunkIdx * chunkSize, (chunkIdx + 1) * chunkSize)
            val base64Chunk = Base64.getEncoder().encodeToString(chunkBytes)
            val writeRes = downloadManager.writeChunk(trackId, chunkIdx, base64Chunk, "mp3")
            assertTrue("Chunk $chunkIdx write must succeed", writeRes.success)
            assertEquals(chunkIdx, writeRes.acceptedChunkIndex)
            assertEquals(chunkIdx + 1, writeRes.nextExpectedChunkIndex)
        }

        val entity = DownloadedTrackEntity(
            id = trackId,
            title = "Byte Accuracy Test",
            artist = "Audio Engine",
            album = "Accuracy Album",
            artworkUrl = "https://example.com/art.jpg",
            localFilePath = "",
            mimeType = "audio/mpeg",
            fileSize = 0L,
            durationMs = 240000L,
            provider = "stuxs"
        )

        val commitRes = downloadManager.commitDownload(entity)
        assertTrue("Commit must succeed", commitRes.success)
        assertNotNull("Local file path must not be null", commitRes.localFilePath)

        // Read resulting disk file and compare byte-for-byte
        val finalFile = File(commitRes.localFilePath!!)
        assertTrue("Final file must exist on disk", finalFile.exists())
        assertEquals("Final file size must match original", totalSize.toLong(), finalFile.length())

        val committedBytes = finalFile.readBytes()
        assertArrayEquals("Committed file bytes must match original bytes EXACTLY", originalBytes, committedBytes)
        assertTrue("Room must contain track record", fakeDao.existsById(trackId))
    }

    @Test
    fun testLargeMultiChunkTransfer() = runBlocking {
        val trackId = "track-large-transfer-test"
        // 1.1 MB payload (4 chunks of 256 KB + 1 remainder chunk of 100 KB = 1,124,000 bytes)
        val fullChunkBytes = 256 * 1024 // 262,144 bytes
        val remainderBytes = 100 * 1024 // 102,400 bytes
        val totalExpected = (4L * fullChunkBytes) + remainderBytes

        downloadManager.beginDownload(trackId, "m4a")

        // Send 4 chunks of 256 KB
        for (i in 0 until 4) {
            val payload = createBase64(fullChunkBytes, fill = (0x10 + i).toByte())
            val res = downloadManager.writeChunk(trackId, i, payload, "m4a")
            assertTrue("Chunk $i must succeed", res.success)
            assertEquals(i + 1, res.nextExpectedChunkIndex)
        }

        // Send remainder chunk 4 (100 KB)
        val remainderPayload = createBase64(remainderBytes, fill = 0x55.toByte())
        val resRem = downloadManager.writeChunk(trackId, 4, remainderPayload, "m4a")
        assertTrue("Remainder chunk 4 must succeed", resRem.success)
        assertEquals(5, resRem.nextExpectedChunkIndex)
        assertEquals(totalExpected, resRem.bytesWritten)

        val entity = DownloadedTrackEntity(
            id = trackId,
            title = "Large Track",
            artist = "Large Artist",
            album = "Large Album",
            artworkUrl = null,
            localFilePath = "",
            mimeType = "audio/mp4",
            fileSize = 0L,
            durationMs = 300000L,
            provider = "stuxs"
        )

        val commitRes = downloadManager.commitDownload(entity)
        assertTrue("Commit for large track must succeed", commitRes.success)
        assertEquals(totalExpected, commitRes.fileSize)

        val finalFile = File(commitRes.localFilePath!!)
        assertTrue("Final large file must exist", finalFile.exists())
        assertEquals(totalExpected, finalFile.length())
    }

    @Test
    fun testNoInvalidRoomRecordAfterAnyFailure() = runBlocking {
        val trackIdFail1 = "track-fail-base64"
        val trackIdFail2 = "track-fail-abort"
        val trackIdFail3 = "track-fail-short"

        // Case 1: Invalid Base64
        downloadManager.beginDownload(trackIdFail1, "mp3")
        downloadManager.writeChunk(trackIdFail1, 0, "NOT_VALID_BASE64!@#$", "mp3")
        assertFalse("Room must not have record after invalid Base64", fakeDao.existsById(trackIdFail1))

        // Case 2: Abort
        downloadManager.beginDownload(trackIdFail2, "mp3")
        downloadManager.writeChunk(trackIdFail2, 0, createBase64(4096), "mp3")
        downloadManager.abortDownload(trackIdFail2)
        assertFalse("Room must not have record after abort", fakeDao.existsById(trackIdFail2))

        // Case 3: Incomplete commit (<10KB)
        downloadManager.beginDownload(trackIdFail3, "mp3")
        downloadManager.writeChunk(trackIdFail3, 0, createBase64(4096), "mp3")
        downloadManager.commitDownload(DownloadedTrackEntity(
            id = trackIdFail3,
            title = "Short",
            artist = "Short",
            album = null,
            artworkUrl = null,
            localFilePath = "",
            mimeType = "audio/mpeg",
            fileSize = 0L,
            durationMs = 10000L,
            provider = "test"
        ))
        assertFalse("Room must not have record after undersized commit failure", fakeDao.existsById(trackIdFail3))
    }

    @Test
    fun testExistingDownloadedFileNotOverwrittenOrCorruptedOnFailedTransfer() = runBlocking {
        val trackId = "track-protected-existing"
        
        // 1. Initial valid download (16 KB with signature byte 0x7A)
        val initialBytes = ByteArray(16384) { 0x7A.toByte() }
        val base64Init = Base64.getEncoder().encodeToString(initialBytes)
        downloadManager.beginDownload(trackId, "mp3")
        downloadManager.writeChunk(trackId, 0, base64Init, "mp3")

        val initialEntity = DownloadedTrackEntity(
            id = trackId,
            title = "Original Safe Track",
            artist = "Original Artist",
            album = "Original Album",
            artworkUrl = null,
            localFilePath = "",
            mimeType = "audio/mpeg",
            fileSize = 0L,
            durationMs = 180000L,
            provider = "stuxs"
        )
        val initialCommit = downloadManager.commitDownload(initialEntity)
        assertTrue("Initial download commit must succeed", initialCommit.success)

        val existingFile = File(initialCommit.localFilePath!!)
        assertTrue("Existing file must exist", existingFile.exists())
        assertEquals(16384L, existingFile.length())
        assertEquals(0x7A.toByte(), existingFile.readBytes()[0])
        val existingRoomRecord = fakeDao.getDownloadedTrackById(trackId)
        assertNotNull("Existing Room record must exist", existingRoomRecord)
        assertEquals("Original Safe Track", existingRoomRecord?.title)

        // 2. Attempt a new transfer for the same trackId that fails / aborts
        downloadManager.beginDownload(trackId, "mp3")
        downloadManager.writeChunk(trackId, 0, createBase64(4096, fill = 0x33.toByte()), "mp3")
        
        // Now abort the second transfer
        downloadManager.abortDownload(trackId)

        // 3. Verify original file and Room record are 100% untouched
        assertTrue("Existing file must STILL exist", existingFile.exists())
        assertEquals("Existing file size must STILL be 16384 bytes", 16384L, existingFile.length())
        assertEquals("Existing file content must NOT be altered", 0x7A.toByte(), existingFile.readBytes()[0])

        val roomAfterAbort = fakeDao.getDownloadedTrackById(trackId)
        assertNotNull("Existing Room record must STILL exist", roomAfterAbort)
        assertEquals("Original Safe Track", roomAfterAbort?.title)
    }

    @Test
    fun testMetadataPreservedFromBeginToCommit() = runBlocking {
        val trackId = "track-staged-metadata-test"
        val metadata = DownloadedTrackEntity(
            id = trackId,
            title = "Staged Title Preserved",
            artist = "Staged Artist Preserved",
            album = "Staged Album",
            artworkUrl = "https://example.com/art.jpg",
            localFilePath = "",
            mimeType = "audio/mpeg",
            fileSize = 0L,
            durationMs = 210000L,
            provider = "jiosaavn"
        )

        downloadManager.beginDownload(trackId, "mp3", metadata)
        val payload = createBase64(12000)
        downloadManager.writeChunk(trackId, 0, payload, "mp3")

        // Call commit with a bare/placeholder entity (e.g. from plugin when metadata is omitted)
        val bareEntity = DownloadedTrackEntity(
            id = trackId,
            title = "Unknown Title",
            artist = "Unknown Artist",
            album = null,
            artworkUrl = null,
            localFilePath = "",
            mimeType = "audio/mpeg",
            fileSize = 0L,
            durationMs = 0L,
            provider = "unknown"
        )

        val commitRes = downloadManager.commitDownload(bareEntity)
        assertTrue("Commit should succeed", commitRes.success)

        val roomRecord = fakeDao.getDownloadedTrackById(trackId)
        assertNotNull(roomRecord)
        assertEquals("Staged Title Preserved", roomRecord?.title)
        assertEquals("Staged Artist Preserved", roomRecord?.artist)
        assertEquals("Staged Album", roomRecord?.album)
        assertEquals("https://example.com/art.jpg", roomRecord?.artworkUrl)
        assertEquals(210000L, roomRecord?.durationMs)
        assertEquals("jiosaavn", roomRecord?.provider)
    }
}
