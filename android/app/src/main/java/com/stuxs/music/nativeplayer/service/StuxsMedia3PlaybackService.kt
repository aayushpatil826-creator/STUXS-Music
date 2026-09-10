package com.stuxs.music.nativeplayer.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.stuxs.music.MainActivity
import com.stuxs.music.R
import com.stuxs.music.nativeplayer.engine.StuxsExoPlayerEngine

@OptIn(UnstableApi::class)
class StuxsForwardingPlayer(
    player: Player,
    private val engine: StuxsExoPlayerEngine
) : ForwardingPlayer(player) {

    override fun getAvailableCommands(): Player.Commands {
        val baseCommands = super.getAvailableCommands().buildUpon()
        if (engine.hasNextTrack()) {
            baseCommands.add(Player.COMMAND_SEEK_TO_NEXT)
            baseCommands.add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
        } else {
            baseCommands.remove(Player.COMMAND_SEEK_TO_NEXT)
            baseCommands.remove(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
        }
        if (engine.hasPreviousTrack()) {
            baseCommands.add(Player.COMMAND_SEEK_TO_PREVIOUS)
            baseCommands.add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
        } else {
            baseCommands.remove(Player.COMMAND_SEEK_TO_PREVIOUS)
            baseCommands.remove(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
        }
        return baseCommands.build()
    }

    override fun isCommandAvailable(command: Int): Boolean {
        return getAvailableCommands().contains(command)
    }

    override fun hasNextMediaItem(): Boolean = engine.hasNextTrack()
    override fun hasNext(): Boolean = engine.hasNextTrack()
    override fun hasNextWindow(): Boolean = engine.hasNextTrack()

    override fun hasPreviousMediaItem(): Boolean = engine.hasPreviousTrack()

    override fun seekToNext() {
        android.util.Log.i("STUXS_SENTINEL", "[FORWARDING_PLAYER_SEEK_NEXT]")
        engine.skipToNext()
    }

    override fun seekToNextMediaItem() {
        android.util.Log.i("STUXS_SENTINEL", "[FORWARDING_PLAYER_SEEK_NEXT_MEDIA_ITEM]")
        engine.skipToNext()
    }

    override fun seekToNextWindow() {
        android.util.Log.i("STUXS_SENTINEL", "[FORWARDING_PLAYER_SEEK_NEXT_WINDOW]")
        engine.skipToNext()
    }

    override fun seekToPrevious() {
        android.util.Log.i("STUXS_SENTINEL", "[FORWARDING_PLAYER_SEEK_PREVIOUS]")
        engine.skipToPrevious()
    }

    override fun seekToPreviousMediaItem() {
        android.util.Log.i("STUXS_SENTINEL", "[FORWARDING_PLAYER_SEEK_PREVIOUS_MEDIA_ITEM]")
        engine.skipToPrevious()
    }

    override fun seekToPreviousWindow() {
        android.util.Log.i("STUXS_SENTINEL", "[FORWARDING_PLAYER_SEEK_PREVIOUS_WINDOW]")
        engine.skipToPrevious()
    }

    private val listeners = java.util.concurrent.CopyOnWriteArrayList<Player.Listener>()

    override fun addListener(listener: Player.Listener) {
        listeners.add(listener)
        super.addListener(listener)
    }

    override fun removeListener(listener: Player.Listener) {
        listeners.remove(listener)
        super.removeListener(listener)
    }

    fun notifyAvailableCommandsChanged() {
        val commands = getAvailableCommands()
        for (l in listeners) {
            try {
                l.onAvailableCommandsChanged(commands)
            } catch (t: Throwable) {
                android.util.Log.w("STUXS_SENTINEL", "[NOTIFY_COMMANDS_ERR]", t)
            }
        }
    }
}

@OptIn(UnstableApi::class)
class StuxsMedia3PlaybackService : MediaSessionService() {
    private var mediaSession: MediaSession? = null
    private var playerEngine: StuxsExoPlayerEngine? = null
    private var forwardingPlayer: StuxsForwardingPlayer? = null

    companion object {
        const val CHANNEL_ID = "stuxs_music_playback"
        const val NOTIFICATION_ID = 1002

        @Volatile
        var instance: StuxsMedia3PlaybackService? = null
            private set

        fun startService(context: Context) {
            val intent = Intent(context, StuxsMedia3PlaybackService::class.java)
            android.util.Log.i("STUXS_SENTINEL", "[SERVICE_START_REQUEST context=" + context.javaClass.simpleName + "]")
            try {
                context.startService(intent)
            } catch (e: Exception) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    try {
                        context.startForegroundService(intent)
                    } catch (e2: Exception) {
                        android.util.Log.w("STUXS_SENTINEL", "[START_SERVICE_FAILED]", e2)
                    }
                }
            }
        }

        fun stopService(context: Context) {
            android.util.Log.i("STUXS_SENTINEL", "[SERVICE_STOP_REQUEST]")
            val intent = Intent(context, StuxsMedia3PlaybackService::class.java)
            context.stopService(intent)
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        android.util.Log.i("STUXS_SENTINEL", "[SERVICE_CREATE pid=" + android.os.Process.myPid() + "]")

        createNotificationChannel()

        val engine = StuxsExoPlayerEngine.getInstance(applicationContext)
        playerEngine = engine

        val fwdPlayer = StuxsForwardingPlayer(engine.exoPlayer, engine)
        forwardingPlayer = fwdPlayer

        engine.addCommandInvalidationListener {
            fwdPlayer.notifyAvailableCommandsChanged()
            mediaSession?.let { session ->
                onUpdateNotification(session, false)
            }
        }

        val activityIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            activityIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val session = MediaSession.Builder(this, fwdPlayer)
            .setSessionActivity(pendingIntent)
            .setCallback(Media3SessionCallback())
            .setId("STUXS_NATIVE_MEDIA3_SESSION")
            .build()
        mediaSession = session
        addSession(session)
        android.util.Log.i("STUXS_SENTINEL", "[MEDIASESSION_ADDED id=" + session.id + "]")

        val notificationProvider = DefaultMediaNotificationProvider.Builder(this)
            .setChannelId(CHANNEL_ID)
            .build()
        setMediaNotificationProvider(notificationProvider)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "STUXS Playback",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "STUXS native audio playback controls"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager?.createNotificationChannel(channel)
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? {
        return mediaSession
    }

    override fun onUpdateNotification(session: MediaSession, startInForegroundRequired: Boolean) {
        val isActivelyPlayingOrBuffering = session.player.playWhenReady &&
                session.player.playbackState != Player.STATE_IDLE &&
                session.player.playbackState != Player.STATE_ENDED
        val required = startInForegroundRequired || isActivelyPlayingOrBuffering
        android.util.Log.i("STUXS_SENTINEL", "[UPDATE_NOTIFICATION playWhenReady=" + session.player.playWhenReady + " state=" + session.player.playbackState + " required=" + required + "]")
        super.onUpdateNotification(session, required)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        android.util.Log.i("STUXS_SENTINEL", "[SERVICE_START_COMMAND flags=" + flags + " startId=" + startId + "]")
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        android.util.Log.w("STUXS_SENTINEL", "[SERVICE_TASK_REMOVED rootIntent=" + rootIntent + "]")
        super.onTaskRemoved(rootIntent)
    }

    fun getPlayerEngine(): StuxsExoPlayerEngine? = playerEngine

    override fun onDestroy() {
        android.util.Log.w("STUXS_SENTINEL", "[SERVICE_DESTROY pid=" + android.os.Process.myPid() + "]")
        mediaSession?.run {
            removeSession(this)
            release()
            mediaSession = null
        }
        forwardingPlayer = null
        playerEngine?.release()
        playerEngine = null
        instance = null
        super.onDestroy()
    }

    private inner class Media3SessionCallback : MediaSession.Callback {
        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo
        ): MediaSession.ConnectionResult {
            val sessionCommands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
                .build()
            val playerCommands = MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS.buildUpon()
                .add(Player.COMMAND_SEEK_TO_NEXT)
                .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                .build()

            return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(sessionCommands)
                .setAvailablePlayerCommands(playerCommands)
                .build()
        }

        override fun onPlayerCommandRequest(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            playerCommand: Int
        ): Int {
            when (playerCommand) {
                Player.COMMAND_SEEK_TO_NEXT,
                Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> {
                    android.util.Log.i("STUXS_SENTINEL", "[SESSION_COMMAND_SEEK_NEXT controller=" + controller.packageName + "]")
                }
                Player.COMMAND_SEEK_TO_PREVIOUS,
                Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> {
                    android.util.Log.i("STUXS_SENTINEL", "[SESSION_COMMAND_SEEK_PREV controller=" + controller.packageName + "]")
                }
            }
            return super.onPlayerCommandRequest(session, controller, playerCommand)
        }

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle
        ): ListenableFuture<SessionResult> {
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }
    }
}
