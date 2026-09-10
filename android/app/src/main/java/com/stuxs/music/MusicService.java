package com.stuxs.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MusicService extends Service {
    private static final String TAG = "STUXS MEDIA";
    public static final String CHANNEL_ID = "stuxs_music_playback";
    public static final int NOTIFICATION_ID = 1001;

    public static final String ACTION_PLAY = "com.stuxs.music.ACTION_PLAY";
    public static final String ACTION_PAUSE = "com.stuxs.music.ACTION_PAUSE";
    public static final String ACTION_NEXT = "com.stuxs.music.ACTION_NEXT";
    public static final String ACTION_PREVIOUS = "com.stuxs.music.ACTION_PREVIOUS";
    public static final String ACTION_STOP = "com.stuxs.music.ACTION_STOP";

    private final IBinder binder = new MusicBinder();
    private MediaSessionCompat mediaSession;
    private PowerManager.WakeLock wakeLock;
    private final ExecutorService imageExecutor = Executors.newSingleThreadExecutor();
    private static final android.util.LruCache<String, Bitmap> artworkCache = new android.util.LruCache<>(30);

    private static volatile boolean isSuppressed = false;
    private static MusicService instance;

    public static synchronized void setSuppressed(boolean suppressed) {
        isSuppressed = suppressed;
        Log.d(TAG, "MusicService setSuppressed=" + suppressed);
        if (instance != null) {
            instance.handleSuppressionChanged(suppressed);
        }
    }

    public static boolean isSuppressed() {
        return isSuppressed;
    }

    public static MusicService getInstance() {
        return instance;
    }

    private void handleSuppressionChanged(boolean suppressed) {
        try {
            if (suppressed) {
                if (isForeground) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                        stopForeground(STOP_FOREGROUND_REMOVE);
                    } else {
                        stopForeground(true);
                    }
                    isForeground = false;
                }
                NotificationManagerCompat manager = NotificationManagerCompat.from(this);
                manager.cancel(NOTIFICATION_ID);
                if (mediaSession != null) {
                    mediaSession.setActive(false);
                }
                releaseWakeLock();
                stopSelf();
            } else {
                if (mediaSession != null) {
                    mediaSession.setActive(true);
                }
                if (isPlaying) {
                    showNotification();
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "handleSuppressionChanged error: " + e.getMessage());
        }
    }

    private String currentTitle = "STUXS Music";
    private String currentArtist = "Your Music, Your Space";
    private String currentAlbum = "";
    private String currentArtworkUrl = "";
    private Bitmap currentArtworkBitmap = null;
    private Bitmap defaultArtworkBitmap = null;
    private boolean isPlaying = false;
    private long currentPosition = 0;
    private long currentDuration = 0;
    private long metadataGeneration = 0;
    private boolean isForeground = false;

    public interface MediaActionListener {
        void onMediaAction(String action, long position);
    }

    private static MediaActionListener actionListener;

    public static void setMediaActionListener(MediaActionListener listener) {
        actionListener = listener;
    }

    public class MusicBinder extends Binder {
        public MusicService getService() {
            return MusicService.this;
        }
    }

    private static final String PREFS_NAME = "stuxs_media_prefs";
    private static final String PREF_TITLE = "last_title";
    private static final String PREF_ARTIST = "last_artist";
    private static final String PREF_ALBUM = "last_album";
    private static final String PREF_ARTWORK = "last_artwork";
    private static final String PREF_DURATION = "last_duration";
    private static final String PREF_POSITION = "last_position";

    private void saveMetadataToPrefs(String title, String artist, String album, String artworkUrl, long duration, long position) {
        try {
            android.content.SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit()
                    .putString(PREF_TITLE, title)
                    .putString(PREF_ARTIST, artist)
                    .putString(PREF_ALBUM, album)
                    .putString(PREF_ARTWORK, artworkUrl)
                    .putLong(PREF_DURATION, duration)
                    .putLong(PREF_POSITION, position)
                    .apply();
        } catch (Exception ignored) {}
    }

    private void restoreMetadataFromPrefs() {
        try {
            android.content.SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String savedTitle = prefs.getString(PREF_TITLE, null);
            if (savedTitle != null && !savedTitle.isEmpty()) {
                currentTitle = savedTitle;
                currentArtist = prefs.getString(PREF_ARTIST, "STUXS Artist");
                currentAlbum = prefs.getString(PREF_ALBUM, "");
                currentArtworkUrl = prefs.getString(PREF_ARTWORK, "");
                currentDuration = prefs.getLong(PREF_DURATION, 0);
                currentPosition = prefs.getLong(PREF_POSITION, 0);
                isPlaying = false;
                Log.d("STUXS MEDIA", "Restored offline track from prefs: " + currentTitle + " - " + currentArtist);
            }
        } catch (Exception ignored) {}
    }

    private synchronized void initMediaSession() {
        if (mediaSession != null) return;

        Intent mediaButtonIntent = new Intent(Intent.ACTION_MEDIA_BUTTON, null, this, androidx.media.session.MediaButtonReceiver.class);
        PendingIntent mbrPendingIntent = PendingIntent.getBroadcast(
                this,
                0,
                mediaButtonIntent,
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        mediaSession = new MediaSessionCompat(this, "STUXSMusicSession", null, mbrPendingIntent);
        mediaSession.setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS);
        mediaSession.setMediaButtonReceiver(mbrPendingIntent);
        mediaSession.setPlaybackToLocal(android.media.AudioManager.STREAM_MUSIC);

        Intent openAppIntent = new Intent(this, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent sessionActivityPendingIntent = PendingIntent.getActivity(
                this,
                0,
                openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );
        mediaSession.setSessionActivity(sessionActivityPendingIntent);

        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                Log.d(TAG, "MediaSession callback: onPlay");
                if (actionListener != null) actionListener.onMediaAction("play", currentPosition);
            }

            @Override
            public void onPause() {
                Log.d(TAG, "MediaSession callback: onPause");
                if (actionListener != null) actionListener.onMediaAction("pause", currentPosition);
            }

            @Override
            public void onSkipToNext() {
                Log.d(TAG, "MediaSession callback: onSkipToNext");
                if (actionListener != null) actionListener.onMediaAction("next", 0);
            }

            @Override
            public void onSkipToPrevious() {
                Log.d(TAG, "MediaSession callback: onSkipToPrevious");
                if (actionListener != null) actionListener.onMediaAction("previous", 0);
            }

            @Override
            public void onSeekTo(long pos) {
                Log.d(TAG, "MediaSession callback: onSeekTo ms=" + pos);
                long sec = Math.max(0, pos / 1000L);
                currentPosition = sec;
                updatePlaybackState();
                if (actionListener != null) actionListener.onMediaAction("seekTo", sec);
            }

            @Override
            public void onStop() {
                Log.d(TAG, "MediaSession callback: onStop");
                if (actionListener != null) actionListener.onMediaAction("stop", 0);
                stopPlaybackService();
            }
        });

        mediaSession.setActive(true);
        Log.d("STUXS MEDIA", "sessionActive=true");
    }

    private synchronized void ensureMediaSession() {
        if (isSuppressed) return;
        if (mediaSession == null) {
            initMediaSession();
        } else if (!mediaSession.isActive()) {
            mediaSession.setActive(true);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();
        loadDefaultArtwork();
        restoreMetadataFromPrefs();

        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "STUXS:PlaybackWakeLock");
            wakeLock.setReferenceCounted(false);
        }

        initMediaSession();

        Log.d("STUXS DEVICE", "manufacturer=" + Build.MANUFACTURER + "\nbrand=" + Build.BRAND + "\nmodel=" + Build.MODEL + "\nandroid=" + Build.VERSION.RELEASE + " (SDK " + Build.VERSION.SDK_INT + ")\nosSkin=" + DeviceInfoHelper.getOsSkin());

        boolean notifGranted = NotificationManagerCompat.from(this).areNotificationsEnabled();
        Log.d("STUXS MEDIA", "notificationPermission=" + (notifGranted ? "GRANTED" : "DENIED"));
        Log.d("STUXS MEDIA", "sessionCreated=true");

        updatePlaybackState();
        updateMediaMetadataCompat(defaultArtworkBitmap);

        // If a valid track was restored on startup, post the media notification immediately (works 100% offline)
        if (currentTitle != null && !currentTitle.equals("STUXS Music")) {
            showNotification();
        }
    }

    private void loadDefaultArtwork() {
        try {
            defaultArtworkBitmap = BitmapFactory.decodeResource(getResources(), R.drawable.stuxs_logo);
            if (defaultArtworkBitmap == null) {
                android.graphics.drawable.Drawable d = androidx.core.content.ContextCompat.getDrawable(this, R.drawable.stuxs_logo);
                if (d != null) {
                    int w = Math.max(1, d.getIntrinsicWidth() > 0 ? d.getIntrinsicWidth() : 256);
                    int h = Math.max(1, d.getIntrinsicHeight() > 0 ? d.getIntrinsicHeight() : 256);
                    Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                    android.graphics.Canvas canvas = new android.graphics.Canvas(b);
                    d.setBounds(0, 0, canvas.getWidth(), canvas.getHeight());
                    d.draw(canvas);
                    defaultArtworkBitmap = b;
                }
            }
        } catch (Exception ignored) {}
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (isSuppressed) {
            Log.d("STUXS MEDIA", "MusicService onStartCommand intercepted because isSuppressed=true");
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    createNotificationChannel();
                    androidx.core.app.NotificationCompat.Builder builder = new androidx.core.app.NotificationCompat.Builder(this, CHANNEL_ID)
                            .setSmallIcon(R.drawable.stuxs_logo)
                            .setContentTitle("STUXS Music")
                            .setPriority(androidx.core.app.NotificationCompat.PRIORITY_MIN);
                    startForeground(NOTIFICATION_ID, builder.build());
                    stopForeground(true);
                }
            } catch (Exception ignored) {}
            stopSelf();
            return START_NOT_STICKY;
        }
        ensureMediaSession();
        if (intent != null) {
            androidx.media.session.MediaButtonReceiver.handleIntent(mediaSession, intent);

            if (intent.getAction() != null) {
                String action = intent.getAction();
                switch (action) {
                    case ACTION_PLAY:
                        if (actionListener != null) actionListener.onMediaAction("play", currentPosition);
                        break;
                    case ACTION_PAUSE:
                        if (actionListener != null) actionListener.onMediaAction("pause", currentPosition);
                        break;
                    case ACTION_NEXT:
                        if (actionListener != null) actionListener.onMediaAction("next", 0);
                        break;
                    case ACTION_PREVIOUS:
                        if (actionListener != null) actionListener.onMediaAction("previous", 0);
                        break;
                    case ACTION_STOP:
                        if (actionListener != null) actionListener.onMediaAction("stop", 0);
                        stopPlaybackService();
                        break;
                }
            }
        }
        return START_STICKY;
    }

    public boolean isForegroundServiceRunning() {
        return isForeground && isPlaying;
    }

    public boolean isMediaSessionActive() {
        return mediaSession != null && mediaSession.isActive();
    }

    public String getCurrentPlaybackStateString() {
        if (mediaSession == null) return "NONE";
        return isPlaying ? "PLAYING" : "PAUSED";
    }

    public String getCurrentTitle() {
        return currentTitle;
    }

    public String getCurrentArtist() {
        return currentArtist;
    }

    public String getCurrentAlbum() {
        return currentAlbum;
    }

    public boolean hasArtworkBitmap() {
        return currentArtworkBitmap != null;
    }

    public synchronized void updateMetadata(String title, String artist, String album, String artworkUrl, long duration, boolean playing, long position) {
        if (isSuppressed) {
            Log.d("STUXS MEDIA", "updateMetadata omitted because MusicService is suppressed by native Media3");
            return;
        }
        ensureMediaSession();
        final long gen = ++metadataGeneration;
        this.currentTitle = (title != null && !title.isEmpty()) ? title : "STUXS Music";
        this.currentArtist = (artist != null && !artist.isEmpty()) ? artist : "STUXS Artist";
        this.currentAlbum = (album != null) ? album : "";
        this.currentDuration = duration;
        this.isPlaying = playing;
        this.currentPosition = position;

        saveMetadataToPrefs(this.currentTitle, this.currentArtist, this.currentAlbum, artworkUrl, this.currentDuration, this.currentPosition);

        Log.d("STUXS MEDIA", "title=" + currentTitle + "\nartist=" + currentArtist);
        Log.d("STUXS MEDIA", "playbackState=" + (playing ? "PLAYING" : "PAUSED"));

        if (playing) {
            acquireWakeLock();
        } else {
            releaseWakeLock();
        }

        updatePlaybackState();

        if (artworkUrl != null && !artworkUrl.isEmpty()) {
            this.currentArtworkUrl = artworkUrl;
            Bitmap cached = artworkCache.get(artworkUrl);
            if (cached != null) {
                this.currentArtworkBitmap = cached;
                updateMediaMetadataCompat(cached);
                showNotification();
            } else {
                // Retain existing artwork (or default) while loading new artwork asynchronously to prevent flashing/generic state
                Bitmap fallback = (currentArtworkBitmap != null) ? currentArtworkBitmap : defaultArtworkBitmap;
                updateMediaMetadataCompat(fallback);
                showNotification();
                loadArtworkAsync(artworkUrl, gen);
            }
        } else {
            this.currentArtworkUrl = "";
            this.currentArtworkBitmap = defaultArtworkBitmap;
            updateMediaMetadataCompat(defaultArtworkBitmap);
            showNotification();
        }
    }

    public synchronized void updatePlaybackStateOnly(boolean playing, long position, long duration) {
        if (isSuppressed) {
            Log.d("STUXS MEDIA", "updatePlaybackStateOnly omitted because MusicService is suppressed by native Media3");
            return;
        }
        ensureMediaSession();
        this.isPlaying = playing;
        this.currentPosition = position;
        if (duration > 0) this.currentDuration = duration;

        saveMetadataToPrefs(this.currentTitle, this.currentArtist, this.currentAlbum, this.currentArtworkUrl, this.currentDuration, this.currentPosition);

        Log.d("STUXS MEDIA", "playbackState=" + (playing ? "PLAYING" : "PAUSED"));

        if (playing) {
            acquireWakeLock();
        } else {
            releaseWakeLock();
        }

        updatePlaybackState();
        showNotification();
    }

    private void updatePlaybackState() {
        ensureMediaSession();
        if (mediaSession == null) return;

        if (!mediaSession.isActive()) {
            mediaSession.setActive(true);
            Log.d(TAG, "MediaSession active = true");
        }

        long actions = PlaybackStateCompat.ACTION_PLAY
                | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                | PlaybackStateCompat.ACTION_SEEK_TO
                | PlaybackStateCompat.ACTION_FAST_FORWARD
                | PlaybackStateCompat.ACTION_REWIND
                | PlaybackStateCompat.ACTION_STOP;

        int state = isPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;

        PlaybackStateCompat.Builder stateBuilder = new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(state, currentPosition * 1000L, isPlaying ? 1.0f : 0.0f, android.os.SystemClock.elapsedRealtime());

        mediaSession.setPlaybackState(stateBuilder.build());
    }

    private void updateMediaMetadataCompat(Bitmap art) {
        ensureMediaSession();
        if (mediaSession == null) return;

        String mediaId = "stuxs_" + Math.abs((currentTitle + "_" + currentArtist).hashCode());

        MediaMetadataCompat.Builder metaBuilder = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, mediaId)
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
                .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentAlbum.isEmpty() ? "STUXS Music" : currentAlbum)
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, currentTitle)
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, currentArtist)
                .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_DESCRIPTION, currentAlbum.isEmpty() ? "STUXS Music" : currentAlbum)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDuration > 0 ? (currentDuration * 1000L) : -1L);

        if (currentArtworkUrl != null && !currentArtworkUrl.isEmpty()) {
            metaBuilder.putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, currentArtworkUrl);
            metaBuilder.putString(MediaMetadataCompat.METADATA_KEY_ART_URI, currentArtworkUrl);
            metaBuilder.putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON_URI, currentArtworkUrl);
        }

        Bitmap bitmapToUse = (art != null) ? art : (currentArtworkBitmap != null ? currentArtworkBitmap : defaultArtworkBitmap);
        if (bitmapToUse != null) {
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bitmapToUse);
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, bitmapToUse);
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, bitmapToUse);
        }

        mediaSession.setMetadata(metaBuilder.build());
    }

    private void loadArtworkAsync(final String urlStr, final long gen) {
        if (urlStr == null || urlStr.isEmpty()) return;

        imageExecutor.execute(() -> {
            Bitmap bmp = null;
            try {
                if (urlStr.startsWith("data:image/") && urlStr.contains("base64,")) {
                    String base64Data = urlStr.substring(urlStr.indexOf("base64,") + 7);
                    byte[] bytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT);
                    bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                } else if (urlStr.startsWith("content://")) {
                    android.net.Uri uri = android.net.Uri.parse(urlStr);
                    try (InputStream is = getContentResolver().openInputStream(uri)) {
                        if (is != null) bmp = BitmapFactory.decodeStream(is);
                    }
                } else if (urlStr.startsWith("file://")) {
                    String path = urlStr.substring(7);
                    bmp = BitmapFactory.decodeFile(path);
                } else if (urlStr.startsWith("/")) {
                    bmp = BitmapFactory.decodeFile(urlStr);
                } else if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
                    URL url = new URL(urlStr);
                    HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                    connection.setDoInput(true);
                    connection.setInstanceFollowRedirects(true);
                    connection.setConnectTimeout(3000);
                    connection.setReadTimeout(3000);
                    connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android " + Build.VERSION.RELEASE + "; " + Build.MODEL + ") STUXS/1.0");
                    connection.connect();
                    int code = connection.getResponseCode();
                    if (code >= 200 && code < 400) {
                        try (InputStream input = connection.getInputStream()) {
                            bmp = BitmapFactory.decodeStream(input);
                        }
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Artwork download/load exception (offline or local): " + e.getMessage());
            }

            if (bmp != null) {
                artworkCache.put(urlStr, bmp);
            }

            synchronized (MusicService.this) {
                if (gen == metadataGeneration) {
                    if (bmp != null) {
                        currentArtworkBitmap = bmp;
                        updateMediaMetadataCompat(bmp);
                    } else if (currentArtworkBitmap == null) {
                        currentArtworkBitmap = defaultArtworkBitmap;
                        updateMediaMetadataCompat(defaultArtworkBitmap);
                    }
                    showNotification();
                }
            }
        });
    }

    private void showNotification() {
        if (isSuppressed) {
            Log.d("STUXS MEDIA", "showNotification omitted because MusicService is suppressed");
            return;
        }
        try {
            ensureMediaSession();
            Notification notification = buildNotification();
            if (notification != null) {
                NotificationManagerCompat manager = NotificationManagerCompat.from(this);

                if (isPlaying) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                    } else {
                        startForeground(NOTIFICATION_ID, notification);
                    }
                    if (!isForeground) {
                        isForeground = true;
                        Log.d("STUXS MEDIA", "foregroundService=started");
                    }
                } else {
                    if (isForeground) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                            stopForeground(STOP_FOREGROUND_DETACH);
                        } else {
                            stopForeground(false);
                        }
                        isForeground = false;
                        Log.d("STUXS MEDIA", "foregroundService=detached/stopped");
                    }
                    manager.notify(NOTIFICATION_ID, notification);
                }
                Log.d("STUXS MEDIA", "notificationPosted=true");
            }
        } catch (Exception e) {
            Log.w(TAG, "showNotification error: " + e.getMessage());
        }
    }

    private Notification buildNotification() {
        Intent openAppIntent = new Intent(this, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentPendingIntent = PendingIntent.getActivity(
                this,
                0,
                openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        PendingIntent prevPendingIntent = buildActionPendingIntent(ACTION_PREVIOUS, 1);
        PendingIntent playPausePendingIntent = buildActionPendingIntent(isPlaying ? ACTION_PAUSE : ACTION_PLAY, 2);
        PendingIntent nextPendingIntent = buildActionPendingIntent(ACTION_NEXT, 3);
        PendingIntent stopPendingIntent = buildActionPendingIntent(ACTION_STOP, 4);

        int playPauseIcon = isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play;
        String playPauseTitle = isPlaying ? "Pause" : "Play";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_music)
                .setContentTitle(currentTitle)
                .setContentText(currentArtist)
                .setSubText(currentAlbum.isEmpty() ? "STUXS Music" : currentAlbum)
                .setContentIntent(contentPendingIntent)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setOngoing(isPlaying)
                .addAction(android.R.drawable.ic_media_previous, "Previous", prevPendingIntent)
                .addAction(playPauseIcon, playPauseTitle, playPausePendingIntent)
                .addAction(android.R.drawable.ic_media_next, "Next", nextPendingIntent)
                .setStyle(new MediaStyle()
                        .setMediaSession(mediaSession != null ? mediaSession.getSessionToken() : null)
                        .setShowActionsInCompactView(0, 1, 2)
                        .setShowCancelButton(true)
                        .setCancelButtonIntent(stopPendingIntent));

        Bitmap bitmapToUse = (currentArtworkBitmap != null) ? currentArtworkBitmap : defaultArtworkBitmap;
        if (bitmapToUse != null) {
            builder.setLargeIcon(bitmapToUse);
        }

        return builder.build();
    }

    private PendingIntent buildActionPendingIntent(String action, int requestCode) {
        Intent intent = new Intent(this, MusicService.class);
        intent.setAction(action);
        return PendingIntent.getService(
                this,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "STUXS Music Playback",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows active playback controls and track information");
            channel.setShowBadge(false);
            channel.setSound(null, null);
            channel.enableVibration(false);
            channel.enableLights(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void acquireWakeLock() {
        if (wakeLock != null && !wakeLock.isHeld()) {
            try {
                wakeLock.acquire(12 * 60 * 60 * 1000L); // 12 hours max safety
            } catch (Exception ignored) {}
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception ignored) {}
        }
    }

    public synchronized void cleanupAndStop() {
        isPlaying = false;
        releaseWakeLock();

        if (mediaSession != null) {
            try {
                PlaybackStateCompat state = new PlaybackStateCompat.Builder()
                        .setActions(0)
                        .setState(PlaybackStateCompat.STATE_STOPPED, 0, 0)
                        .build();
                mediaSession.setPlaybackState(state);
                mediaSession.setMetadata(null);
                mediaSession.setActive(false);
                mediaSession.release();
                mediaSession = null;
                Log.d(TAG, "PlaybackState=STOPPED");
                Log.d(TAG, "MediaSession active=false");
            } catch (Exception ignored) {}
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
            isForeground = false;
            Log.d(TAG, "Foreground service=stopped");

            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.cancel(NOTIFICATION_ID);
                manager.cancelAll();
            }
        } catch (Exception ignored) {}

        stopSelf();
    }

    public void stopPlaybackService() {
        cleanupAndStop();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        Log.d(TAG, "App task removed from recents");
        if (isPlaying) {
            Log.d(TAG, "Active playback continues in foreground");
            return;
        }
    }

    @Override
    public void onDestroy() {
        if (instance == this) {
            instance = null;
        }
        cleanupAndStop();
        imageExecutor.shutdown();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    public static class DeviceInfoHelper {
        public static String getSystemProperty(String key) {
            try {
                Class<?> clazz = Class.forName("android.os.SystemProperties");
                java.lang.reflect.Method get = clazz.getMethod("get", String.class, String.class);
                return (String) get.invoke(null, key, "");
            } catch (Exception e) {
                return "";
            }
        }

        public static String getOsSkin() {
            String mfr = (Build.MANUFACTURER != null) ? Build.MANUFACTURER.toLowerCase() : "";
            String brand = (Build.BRAND != null) ? Build.BRAND.toLowerCase() : "";

            // Vivo / iQOO Detection
            String vivoRom = getSystemProperty("ro.vivo.os.version");
            String vivoBuild = getSystemProperty("ro.vivo.os.build.display.id");
            String vivoRomVer = getSystemProperty("ro.vivo.rom.version");
            if (!vivoRom.isEmpty()) {
                return "OriginOS " + vivoRom;
            } else if (!vivoBuild.isEmpty()) {
                if (vivoBuild.toLowerCase().contains("originos")) {
                    return vivoBuild;
                } else if (vivoBuild.toLowerCase().contains("funtouch")) {
                    return vivoBuild;
                }
                return "Vivo " + vivoBuild;
            } else if (!vivoRomVer.isEmpty()) {
                return "FuntouchOS " + vivoRomVer;
            } else if (mfr.contains("vivo") || mfr.contains("iqoo") || brand.contains("vivo") || brand.contains("iqoo")) {
                return "FuntouchOS / OriginOS";
            }

            // Oppo / OnePlus / Realme (ColorOS / OxygenOS / Realme UI)
            String colorOs = getSystemProperty("ro.build.version.opporom");
            String oplusRom = getSystemProperty("ro.build.version.oplusrom");
            if (!colorOs.isEmpty()) {
                return "ColorOS " + colorOs;
            } else if (!oplusRom.isEmpty()) {
                return "OxygenOS/ColorOS " + oplusRom;
            } else if (mfr.contains("oppo")) {
                return "ColorOS";
            } else if (mfr.contains("oneplus")) {
                return "OxygenOS";
            } else if (mfr.contains("realme")) {
                return "Realme UI";
            }

            // Xiaomi / Redmi / POCO (HyperOS / MIUI)
            String hyperOs = getSystemProperty("ro.mi.os.version.name");
            String miui = getSystemProperty("ro.miui.ui.version.name");
            if (!hyperOs.isEmpty()) {
                return "HyperOS " + hyperOs;
            } else if (!miui.isEmpty()) {
                return "MIUI " + miui;
            } else if (mfr.contains("xiaomi") || mfr.contains("redmi") || mfr.contains("poco")) {
                return "HyperOS / MIUI";
            }

            // Samsung One UI
            if (mfr.contains("samsung")) {
                return "One UI";
            }

            // Google Pixel
            if (mfr.contains("google")) {
                return "Stock Pixel Android";
            }

            return "Android AOSP (" + Build.DISPLAY + ")";
        }
    }
}