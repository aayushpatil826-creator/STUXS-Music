package com.stuxs.music.nativeplayer.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

// ---------------------------------------------------------------------------
// 1. DownloadedTrackEntity: Stores verified offline audio files on native disk
// ---------------------------------------------------------------------------
@Entity(tableName = "downloaded_tracks")
data class DownloadedTrackEntity(
    @PrimaryKey
    val id: String,
    val title: String,
    val artist: String,
    val album: String?,
    val artworkUrl: String?,
    val localFilePath: String,
    val mimeType: String,
    val fileSize: Long,
    val durationMs: Long,
    val provider: String,
    val downloadedAt: Long = System.currentTimeMillis()
)

// ---------------------------------------------------------------------------
// 2. LocalTrackEntity: Stores device local music metadata
// ---------------------------------------------------------------------------
@Entity(tableName = "local_tracks")
data class LocalTrackEntity(
    @PrimaryKey
    val id: String,
    val title: String,
    val artist: String,
    val album: String?,
    val artworkUri: String?,
    val contentUri: String,
    val filePath: String?,
    val durationMs: Long,
    val fileSize: Long,
    val mimeType: String,
    val addedAt: Long = System.currentTimeMillis()
)

// ---------------------------------------------------------------------------
// 3. DAOs
// ---------------------------------------------------------------------------
@Dao
interface DownloadedTrackDao {
    @Query("SELECT * FROM downloaded_tracks ORDER BY downloadedAt DESC")
    fun getAllDownloadedTracks(): Flow<List<DownloadedTrackEntity>>

    @Query("SELECT * FROM downloaded_tracks ORDER BY downloadedAt DESC")
    suspend fun getAllDownloadedTracksSync(): List<DownloadedTrackEntity>

    @Query("SELECT * FROM downloaded_tracks WHERE id = :id LIMIT 1")
    suspend fun getDownloadedTrackById(id: String): DownloadedTrackEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDownloadedTrack(track: DownloadedTrackEntity)

    @Query("DELETE FROM downloaded_tracks WHERE id = :id")
    suspend fun deleteDownloadedTrackById(id: String): Int

    @Query("SELECT COUNT(*) FROM downloaded_tracks WHERE id = :id")
    suspend fun isTrackDownloaded(id: String): Int

    @Query("SELECT id FROM downloaded_tracks")
    suspend fun getAllTrackIds(): List<String>

    @Query("SELECT EXISTS(SELECT 1 FROM downloaded_tracks WHERE id = :id)")
    suspend fun existsById(id: String): Boolean
}

@Dao
interface LocalTrackDao {
    @Query("SELECT * FROM local_tracks ORDER BY addedAt DESC")
    fun getAllLocalTracks(): Flow<List<LocalTrackEntity>>

    @Query("SELECT * FROM local_tracks WHERE id = :id LIMIT 1")
    suspend fun getLocalTrackById(id: String): LocalTrackEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertLocalTracks(tracks: List<LocalTrackEntity>)

    @Query("DELETE FROM local_tracks WHERE id = :id")
    suspend fun deleteLocalTrackById(id: String): Int
}

// ---------------------------------------------------------------------------
// 4. StuxsNativeDatabase
// ---------------------------------------------------------------------------
@Database(
    entities = [DownloadedTrackEntity::class, LocalTrackEntity::class],
    version = 1,
    exportSchema = false
)
abstract class StuxsNativeDatabase : RoomDatabase() {
    abstract fun downloadedTrackDao(): DownloadedTrackDao
    abstract fun localTrackDao(): LocalTrackDao

    companion object {
        @Volatile
        private var INSTANCE: StuxsNativeDatabase? = null

        fun getInstance(context: android.content.Context): StuxsNativeDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    StuxsNativeDatabase::class.java,
                    "stuxs_native_music.db"
                ).build()
                INSTANCE = instance
                instance
            }
        }
    }
}
