package com.stuxs.music;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeMediaSession")
public class MediaSessionPlugin extends Plugin {
    private MusicService musicService;
    private boolean isBound = false;

    private static class PendingMetadata {
        String title, artist, album, artworkUrl;
        long duration, position;
        boolean isPlaying;
    }
    private PendingMetadata pendingMetadata = null;

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
            MusicService.MusicBinder musicBinder = (MusicService.MusicBinder) binder;
            musicService = musicBinder.getService();
            isBound = true;
            if (pendingMetadata != null && musicService != null) {
                musicService.updateMetadata(
                        pendingMetadata.title,
                        pendingMetadata.artist,
                        pendingMetadata.album,
                        pendingMetadata.artworkUrl,
                        pendingMetadata.duration,
                        pendingMetadata.isPlaying,
                        pendingMetadata.position
                );
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            musicService = null;
            isBound = false;
        }
    };

    @Override
    public void load() {
        super.load();

        MusicService.setMediaActionListener((action, position) -> {
            JSObject data = new JSObject();
            data.put("action", action);
            data.put("position", position);
            notifyListeners("mediaAction", data);
        });

        // Safely bind service without calling startForegroundService on startup
        bindMusicService(false);
    }

    private void bindMusicService(boolean startForeground) {
        if (MusicService.isSuppressed()) {
            return;
        }
        try {
            Context context = getContext();
            if (context == null) return;
            Intent intent = new Intent(context, MusicService.class);

            if (startForeground) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent);
                } else {
                    context.startService(intent);
                }
            } else {
                context.startService(intent);
            }
            context.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
        } catch (Exception e) {
            // Graceful fallback for devices with aggressive background restrictions
        }
    }

    @PluginMethod
    public void setMetadata(PluginCall call) {
        if (MusicService.isSuppressed()) {
            call.resolve();
            return;
        }
        String title = call.getString("title", "STUXS Music");
        String artist = call.getString("artist", "");
        String album = call.getString("album", "");
        String artworkUrl = call.getString("artworkUrl", "");
        long duration = call.getInt("duration", 0);
        boolean isPlaying = Boolean.TRUE.equals(call.getBoolean("isPlaying", false));
        long position = call.getInt("position", 0);

        PendingMetadata meta = new PendingMetadata();
        meta.title = title;
        meta.artist = artist;
        meta.album = album;
        meta.artworkUrl = artworkUrl;
        meta.duration = duration;
        meta.isPlaying = isPlaying;
        meta.position = position;
        this.pendingMetadata = meta;

        bindMusicService(isPlaying);

        if (musicService != null) {
            musicService.updateMetadata(title, artist, album, artworkUrl, duration, isPlaying, position);
        }

        call.resolve();
    }

    @PluginMethod
    public void setPlaybackState(PluginCall call) {
        if (MusicService.isSuppressed()) {
            call.resolve();
            return;
        }
        boolean isPlaying = Boolean.TRUE.equals(call.getBoolean("isPlaying", false));
        long position = call.getInt("position", 0);
        long duration = call.getInt("duration", 0);

        bindMusicService(isPlaying);

        if (musicService != null) {
            musicService.updatePlaybackStateOnly(isPlaying, position, duration);
        }

        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (musicService != null) {
            musicService.stopPlaybackService();
        }
        call.resolve();
    }

    @PluginMethod
    public void checkNotificationPermission(PluginCall call) {
        Context ctx = getContext();
        boolean notifGranted = false;
        if (ctx != null) {
            notifGranted = androidx.core.app.NotificationManagerCompat.from(ctx).areNotificationsEnabled();
        }
        JSObject ret = new JSObject();
        ret.put("granted", notifGranted);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getActivity() != null) {
            getActivity().requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 101);
        }
        JSObject ret = new JSObject();
        ret.put("requested", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void getDiagnostics(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("deviceManufacturer", Build.MANUFACTURER);
        ret.put("deviceBrand", Build.BRAND);
        ret.put("deviceModel", Build.MODEL);
        ret.put("androidVersion", Build.VERSION.RELEASE);
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        ret.put("isServiceBound", isBound);
        ret.put("isForegroundRunning", musicService != null && musicService.isForegroundServiceRunning());
        ret.put("isMediaSessionActive", musicService != null && musicService.isMediaSessionActive());
        ret.put("playbackState", musicService != null ? musicService.getCurrentPlaybackStateString() : "NONE");
        ret.put("currentTitle", musicService != null ? musicService.getCurrentTitle() : "");
        ret.put("currentArtist", musicService != null ? musicService.getCurrentArtist() : "");
        ret.put("hasArtworkBitmap", musicService != null && musicService.hasArtworkBitmap());

        Context ctx = getContext();
        if (ctx != null) {
            boolean notifGranted = androidx.core.app.NotificationManagerCompat.from(ctx).areNotificationsEnabled();
            ret.put("hasNotificationPermission", notifGranted);

            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            boolean ignoringBattery = (pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) 
                    ? pm.isIgnoringBatteryOptimizations(ctx.getPackageName()) 
                    : true;
            ret.put("isIgnoringBatteryOptimizations", ignoringBattery);
        } else {
            ret.put("hasNotificationPermission", false);
            ret.put("isIgnoringBatteryOptimizations", false);
        }

        String mfr = Build.MANUFACTURER.toLowerCase();
        boolean oemSupported = mfr.contains("vivo") || mfr.contains("iqoo") || mfr.contains("xiaomi") 
                || mfr.contains("redmi") || mfr.contains("oppo") || mfr.contains("realme") 
                || mfr.contains("oneplus") || mfr.contains("samsung") || mfr.contains("nothing");
        ret.put("oemLiveCapsuleCapability", oemSupported);

        call.resolve(ret);
    }

    @PluginMethod
    public void openBatteryOptimizationSettings(PluginCall call) {
        Context ctx = getContext();
        if (ctx != null) {
            try {
                Intent intent = new Intent();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    intent.setAction(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                } else {
                    intent.setAction(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(android.net.Uri.parse("package:" + ctx.getPackageName()));
                }
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
            } catch (Exception e) {
                try {
                    Intent fallback = new Intent(android.provider.Settings.ACTION_SETTINGS);
                    fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    ctx.startActivity(fallback);
                } catch (Exception ignored) {}
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Context ctx = getContext();
        if (ctx != null) {
            try {
                Intent intent = new Intent();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    intent.setAction(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                    intent.putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
                } else {
                    intent.setAction(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(android.net.Uri.parse("package:" + ctx.getPackageName()));
                }
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
            } catch (Exception e) {
                try {
                    Intent fallback = new Intent(android.provider.Settings.ACTION_SETTINGS);
                    fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    ctx.startActivity(fallback);
                } catch (Exception ignored) {}
            }
        }
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (isBound) {
            try {
                getContext().unbindService(serviceConnection);
                isBound = false;
            } catch (Exception ignored) {}
        }
        super.handleOnDestroy();
    }
}