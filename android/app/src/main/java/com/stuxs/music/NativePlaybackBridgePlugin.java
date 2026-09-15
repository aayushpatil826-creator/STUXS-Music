package com.stuxs.music;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.stuxs.music.nativeplayer.engine.StuxsExoPlayerEngine;
import com.stuxs.music.nativeplayer.model.NativePlaybackState;
import com.stuxs.music.nativeplayer.model.NativeRepeatMode;
import com.stuxs.music.nativeplayer.model.NativeTrack;
import com.stuxs.music.nativeplayer.model.StateType;
import com.stuxs.music.nativeplayer.service.StuxsMedia3PlaybackService;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import com.stuxs.music.nativeplayer.bridge.NativeChunkedDownloadManager;
import com.stuxs.music.nativeplayer.bridge.ChunkWriteResult;
import com.stuxs.music.nativeplayer.bridge.CommitResult;
import com.stuxs.music.nativeplayer.bridge.AbortResult;
import com.stuxs.music.nativeplayer.data.DownloadedTrackEntity;
import com.stuxs.music.nativeplayer.data.repository.NativeDownloadRepository;

@CapacitorPlugin(name = "NativePlaybackBridge")
public class NativePlaybackBridgePlugin extends Plugin {

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private void runOnMain(Runnable r) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            r.run();
        } else {
            mainHandler.post(r);
        }
    }

    private synchronized StuxsExoPlayerEngine getEngine() {
        StuxsMedia3PlaybackService service = StuxsMedia3PlaybackService.Companion.getInstance();
        StuxsExoPlayerEngine engine = null;
        if (service != null && service.getPlayerEngine() != null) {
            engine = service.getPlayerEngine();
        } else {
            Context ctx = getContext();
            if (ctx == null && getActivity() != null) {
                ctx = getActivity().getApplicationContext();
            }
            engine = StuxsExoPlayerEngine.Companion.getInstance(ctx != null ? ctx : getBridge().getContext());
        }
        attachEngineListeners(engine);
        return engine;
    }

    private StuxsExoPlayerEngine lastAttachedEngine = null;

    private void attachEngineListeners(StuxsExoPlayerEngine engine) {
        if (engine == null || engine == lastAttachedEngine) return;
        lastAttachedEngine = engine;

        engine.setOnTrackChangedListener((track, index) -> {
            runOnMain(() -> {
                JSObject data = new JSObject();
                data.put("id", track.getId());
                data.put("title", track.getTitle());
                data.put("artist", track.getArtist());
                data.put("album", track.getAlbum());
                data.put("artworkUrl", track.getArtworkUrl());
                data.put("durationMs", track.getDurationMs());
                data.put("positionMs", 0L);
                data.put("isPlaying", true);
                data.put("provider", track.getProvider());
                data.put("currentIndex", index);
                notifyListeners("trackChanged", data);
            });
            return kotlin.Unit.INSTANCE;
        });

        engine.setOnPlaybackEndedListener(() -> {
            runOnMain(() -> {
                notifyListeners("playbackEnded", new JSObject());
            });
            return kotlin.Unit.INSTANCE;
        });

        engine.setOnPlaybackStateChangedListener((stateType) -> {
            runOnMain(() -> {
                JSObject data = new JSObject();
                data.put("state", stateType.name());
                data.put("isPlaying", stateType == com.stuxs.music.nativeplayer.model.StateType.PLAYING);
                data.put("isBuffering", stateType == com.stuxs.music.nativeplayer.model.StateType.BUFFERING);
                notifyListeners("playbackStateChanged", data);
            });
            return kotlin.Unit.INSTANCE;
        });
    }

    private List<NativeTrack> parseTracksArray(JSArray tracksArray) {
        if (tracksArray == null) return null;
        List<NativeTrack> nativeTracks = new ArrayList<>();
        try {
            JSONArray jsonArray = tracksArray;
            for (int i = 0; i < jsonArray.length(); i++) {
                JSONObject obj = jsonArray.getJSONObject(i);
                String id = obj.optString("id", "track-" + i);
                String title = obj.optString("title", "Track");
                String artist = obj.optString("artist", "Artist");
                String album = obj.optString("album", "");
                String artworkUrl = obj.optString("artworkUrl", "");
                String audioUrl = obj.optString("audioUrl", null);
                String localFilePath = obj.optString("localFilePath", null);
                long durationMs = obj.optLong("durationMs", 0);
                String provider = obj.optString("provider", "stuxs");
                boolean isM3U = obj.optBoolean("isM3U", false) || obj.optBoolean("isHls", false);
                String lyricsLrc = obj.optString("lyricsLrc", null);

                boolean isLocal = (localFilePath != null && !localFilePath.isEmpty())
                        || "local".equalsIgnoreCase(provider)
                        || (id != null && id.startsWith("local_"))
                        || (audioUrl != null && (audioUrl.startsWith("content://") || audioUrl.startsWith("file://") || audioUrl.startsWith("/")));

                nativeTracks.add(new NativeTrack(
                        id, title, artist, album, artworkUrl, audioUrl, durationMs,
                        provider, isLocal,
                        false, localFilePath, isM3U, lyricsLrc
                ));
            }
        } catch (Exception ignored) {}
        return nativeTracks;
    }

    @PluginMethod
    public void activateNativeMode(PluginCall call) {
        runOnMain(() -> {
            try {
                Context ctx = getContext();
                if (ctx != null) {
                    StuxsMedia3PlaybackService.Companion.startService(ctx);
                }
                MusicService.setSuppressed(true);
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("nativeModeActive", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to activate native mode: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void deactivateNativeMode(PluginCall call) {
        runOnMain(() -> {
            try {
                StuxsExoPlayerEngine engine = getEngine();
                if (engine != null) {
                    engine.pause();
                }
                Context ctx = getContext();
                if (ctx != null) {
                    StuxsMedia3PlaybackService.Companion.stopService(ctx);
                }
                MusicService.setSuppressed(false);
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("nativeModeActive", false);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to deactivate native mode: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void playTrack(PluginCall call) {
        String id = call.getString("id");
        String title = call.getString("title", "STUXS Track");
        String artist = call.getString("artist", "STUXS Artist");
        String album = call.getString("album", "");
        String artworkUrl = call.getString("artworkUrl", "");
        String audioUrl = call.getString("audioUrl");
        String localFilePath = call.getString("localFilePath");
        long durationMs = call.getInt("durationMs", 0);
        String provider = call.getString("provider", "stuxs");
        boolean isM3U = call.getBoolean("isM3U", false) || call.getBoolean("isHls", false);
        String lyricsLrc = call.getString("lyricsLrc");

        JSArray queueArray = call.getArray("queue");
        int startIndex = call.getInt("startIndex", 0);
        long initialPositionMs = call.getInt("initialPositionMs", 0);
        List<NativeTrack> queueTracks = parseTracksArray(queueArray);

        String repeatModeStr = call.getString("repeatMode");
        Boolean shuffleEnabled = call.hasOption("shuffleEnabled") ? call.getBoolean("shuffleEnabled") : null;

        if (id == null || id.isEmpty()) {
            call.reject("Track id is required");
            return;
        }

        if ((audioUrl == null || audioUrl.isEmpty()) && (localFilePath == null || localFilePath.isEmpty()) && (queueTracks == null || queueTracks.isEmpty())) {
            call.reject("Track must have valid audioUrl or localFilePath");
            return;
        }

        boolean isLocal = (localFilePath != null && !localFilePath.isEmpty())
                || "local".equalsIgnoreCase(provider)
                || (id != null && id.startsWith("local_"))
                || (audioUrl != null && (audioUrl.startsWith("content://") || audioUrl.startsWith("file://") || audioUrl.startsWith("/")));

        NativeTrack track = new NativeTrack(
                id,
                title,
                artist,
                album,
                artworkUrl,
                audioUrl,
                durationMs,
                provider,
                isLocal,
                false,
                localFilePath,
                isM3U,
                lyricsLrc
        );

        runOnMain(() -> {
            try {
                Context ctx = getContext();
                if (ctx != null) {
                    StuxsMedia3PlaybackService.Companion.startService(ctx);
                }
                MusicService.setSuppressed(true);

                StuxsExoPlayerEngine engine = getEngine();
                if (engine != null) {
                    if (repeatModeStr != null) {
                        NativeRepeatMode mode = NativeRepeatMode.OFF;
                        if ("ALL".equalsIgnoreCase(repeatModeStr)) mode = NativeRepeatMode.ALL;
                        else if ("ONE".equalsIgnoreCase(repeatModeStr)) mode = NativeRepeatMode.ONE;
                        engine.setRepeatMode(mode);
                    }
                    if (shuffleEnabled != null) {
                        engine.setShuffleMode(shuffleEnabled);
                    }

                    if (queueTracks != null && !queueTracks.isEmpty()) {
                        engine.setQueue(queueTracks, startIndex, initialPositionMs);
                    } else {
                        engine.playTrack(track, initialPositionMs);
                    }
                }

                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("id", id);
                ret.put("title", title);
                ret.put("state", "PLAYING");
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Native playTrack failed: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void togglePlay(PluginCall call) {
        runOnMain(() -> {
            try {
                StuxsExoPlayerEngine engine = getEngine();
                if (engine == null) {
                    call.reject("Native player engine unavailable");
                    return;
                }
                NativePlaybackState state = engine.getPlaybackState().getValue();
                boolean currentlyPlaying = state.getState() == StateType.PLAYING;
                if (currentlyPlaying) {
                    engine.pause();
                } else {
                    MusicService.setSuppressed(true);
                    engine.play();
                }
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("isPlaying", !currentlyPlaying);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to toggle play: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        runOnMain(() -> {
            try {
                StuxsExoPlayerEngine engine = getEngine();
                if (engine != null) {
                    engine.pause();
                }
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("isPlaying", false);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to pause native playback: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        runOnMain(() -> {
            try {
                StuxsExoPlayerEngine engine = getEngine();
                if (engine != null) {
                    engine.stop();
                }
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("isPlaying", false);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to stop native playback: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void resume(PluginCall call) {
        runOnMain(() -> {
            try {
                MusicService.setSuppressed(true);
                StuxsExoPlayerEngine engine = getEngine();
                if (engine != null) {
                    engine.play();
                }
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("isPlaying", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to resume native playback: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        long positionMs = call.getInt("positionMs", 0);
        runOnMain(() -> {
            try {
                StuxsExoPlayerEngine engine = getEngine();
                boolean isPlaying = false;
                String stateStr = "IDLE";
                if (engine != null) {
                    engine.seekTo(positionMs);
                    com.stuxs.music.nativeplayer.model.NativePlaybackState state = engine.getPlaybackState().getValue();
                    isPlaying = state.getState() == com.stuxs.music.nativeplayer.model.StateType.PLAYING || (engine.getExoPlayer().getPlayWhenReady() && engine.getExoPlayer().getPlaybackState() != androidx.media3.common.Player.STATE_ENDED && engine.getExoPlayer().getPlaybackState() != androidx.media3.common.Player.STATE_IDLE);
                    stateStr = state.getState().name();
                }
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("positionMs", positionMs);
                ret.put("isPlaying", isPlaying);
                ret.put("state", stateStr);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to seek: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void reloadCurrentTrackSource(PluginCall call) {
        String audioUrl = call.getString("audioUrl");
        long initialPositionMs = 0L;
        if (call.hasOption("initialPositionMs")) {
            initialPositionMs = call.getInt("initialPositionMs", 0);
        } else if (call.hasOption("positionMs")) {
            initialPositionMs = call.getInt("positionMs", 0);
        }
        boolean playWhenReady = call.getBoolean("playWhenReady", true);

        if (audioUrl == null || audioUrl.isEmpty()) {
            call.reject("audioUrl is required");
            return;
        }

        final long finalPos = initialPositionMs;
        runOnMain(() -> {
            try {
                StuxsExoPlayerEngine engine = getEngine();
                if (engine == null) {
                    call.reject("Native player engine unavailable");
                    return;
                }
                engine.reloadCurrentTrackSource(audioUrl, finalPos, playWhenReady);
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("audioUrl", audioUrl);
                ret.put("positionMs", finalPos);
                ret.put("playWhenReady", playWhenReady);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to reload current track source: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void skipToNext(PluginCall call) {
        runOnMain(() -> {
            try {
                StuxsExoPlayerEngine engine = getEngine();
                boolean skipped = engine != null && engine.skipToNext();
                JSObject ret = new JSObject();
                ret.put("success", skipped);
                ret.put("skipped", skipped);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to skip next: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void skipToPrevious(PluginCall call) {
        runOnMain(() -> {
            try {
                StuxsExoPlayerEngine engine = getEngine();
                boolean skipped = engine != null && engine.skipToPrevious();
                JSObject ret = new JSObject();
                ret.put("success", skipped);
                ret.put("skipped", skipped);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to skip previous: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void setQueue(PluginCall call) {
        JSArray tracksArray = call.getArray("tracks");
        int startIndex = call.getInt("startIndex", 0);
        long initialPositionMs = call.getInt("initialPositionMs", 0);

        if (tracksArray == null) {
            call.reject("Tracks array is required");
            return;
        }

        List<NativeTrack> nativeTracks = parseTracksArray(tracksArray);
        if (nativeTracks == null || nativeTracks.isEmpty()) {
            call.reject("Failed to parse tracks array");
            return;
        }

        runOnMain(() -> {
            try {
                Context ctx = getContext();
                if (ctx != null) {
                    StuxsMedia3PlaybackService.Companion.startService(ctx);
                }
                MusicService.setSuppressed(true);

                StuxsExoPlayerEngine engine = getEngine();
                if (engine != null) {
                    engine.setQueue(nativeTracks, startIndex, initialPositionMs);
                }
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("queueLength", nativeTracks.size());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to set native queue: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void updateQueue(PluginCall call) {
        JSArray tracksArray = call.getArray("tracks");
        if (tracksArray == null) {
            call.reject("Tracks array is required");
            return;
        }

        Integer newIndex = call.hasOption("newIndex") ? call.getInt("newIndex") : null;
        List<NativeTrack> nativeTracks = parseTracksArray(tracksArray);
        if (nativeTracks == null) {
            call.reject("Failed to parse tracks array");
            return;
        }

        runOnMain(() -> {
            try {
                StuxsExoPlayerEngine engine = getEngine();
                if (engine != null) {
                    engine.updateQueueOnly(nativeTracks, newIndex);
                }
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("queueLength", nativeTracks.size());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to update native queue: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void setRepeatMode(PluginCall call) {
        String modeStr = call.getString("mode", "OFF");
        NativeRepeatMode mode = NativeRepeatMode.OFF;
        if ("ALL".equalsIgnoreCase(modeStr)) mode = NativeRepeatMode.ALL;
        else if ("ONE".equalsIgnoreCase(modeStr)) mode = NativeRepeatMode.ONE;

        final NativeRepeatMode finalMode = mode;
        runOnMain(() -> {
            try {
                StuxsExoPlayerEngine engine = getEngine();
                if (engine != null) {
                    engine.setRepeatMode(finalMode);
                }
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("repeatMode", finalMode.name());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to set repeat mode: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void setShuffleMode(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        runOnMain(() -> {
            try {
                StuxsExoPlayerEngine engine = getEngine();
                if (engine != null) {
                    engine.setShuffleMode(enabled);
                }
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("shuffleEnabled", enabled);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to set shuffle mode: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void getPlaybackState(PluginCall call) {
        runOnMain(() -> {
            try {
                StuxsExoPlayerEngine engine = getEngine();
                if (engine == null) {
                    call.reject("Engine unavailable");
                    return;
                }
                NativePlaybackState state = engine.getPlaybackState().getValue();

                boolean playWhenReady = engine.getExoPlayer().getPlayWhenReady();
                int playbackState = engine.getExoPlayer().getPlaybackState();
                boolean isLogicallyPlaying = playWhenReady &&
                        playbackState != androidx.media3.common.Player.STATE_IDLE &&
                        playbackState != androidx.media3.common.Player.STATE_ENDED;
                boolean isBuffering = playbackState == androidx.media3.common.Player.STATE_BUFFERING;

                long livePos = Math.max(0, engine.getExoPlayer().getCurrentPosition());
                long liveDur = Math.max(0, engine.getExoPlayer().getDuration());
                NativeTrack currentTrack = state.getCurrentTrack();
                long effectiveDur = liveDur > 0 ? liveDur : (currentTrack != null ? currentTrack.getDurationMs() : state.getDurationMs());
                long effectivePos = (isBuffering && effectiveDur > 0 && livePos > effectiveDur) ? 0L : livePos;

                JSObject ret = new JSObject();
                ret.put("state", isLogicallyPlaying ? "PLAYING" : (isBuffering ? "BUFFERING" : state.getState().name()));
                ret.put("isPlaying", isLogicallyPlaying);
                ret.put("isBuffering", isBuffering);
                ret.put("positionMs", effectivePos);
                ret.put("durationMs", effectiveDur);
                ret.put("bufferedPositionMs", Math.max(0, engine.getExoPlayer().getBufferedPosition()));
                ret.put("repeatMode", state.getRepeatMode().name());
                ret.put("shuffleEnabled", state.getShuffleEnabled());
                ret.put("currentIndex", state.getCurrentIndex());
                ret.put("queueLength", state.getQueue().size());

                JSArray queueArr = new JSArray();
                List<NativeTrack> qTracks = state.getQueue();
                if (qTracks != null) {
                    for (NativeTrack t : qTracks) {
                        JSObject to = new JSObject();
                        to.put("id", t.getId());
                        to.put("title", t.getTitle());
                        to.put("artist", t.getArtist());
                        to.put("album", t.getAlbum());
                        to.put("artworkUrl", t.getArtworkUrl());
                        to.put("audioUrl", t.getAudioUrl());
                        to.put("durationMs", t.getDurationMs());
                        to.put("provider", t.getProvider());
                        to.put("localFilePath", t.getLocalFilePath());
                        to.put("isDownloaded", t.isDownloaded());
                        to.put("isM3U", t.isM3U());
                        to.put("lyricsLrc", t.getLyricsLrc());
                        queueArr.put(to);
                    }
                }
                ret.put("queue", queueArr);

                if (state.getCurrentTrack() != null) {
                    JSObject trackObj = new JSObject();
                    trackObj.put("id", state.getCurrentTrack().getId());
                    trackObj.put("title", state.getCurrentTrack().getTitle());
                    trackObj.put("artist", state.getCurrentTrack().getArtist());
                    trackObj.put("album", state.getCurrentTrack().getAlbum());
                    trackObj.put("artworkUrl", state.getCurrentTrack().getArtworkUrl());
                    trackObj.put("provider", state.getCurrentTrack().getProvider());
                    ret.put("currentTrack", trackObj);
                }
                if (state.getErrorMessage() != null) {
                    ret.put("errorMessage", state.getErrorMessage());
                }
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to query native player state: " + e.getMessage(), e);
            }
        });
    }

    // Backward compatibility methods for Phase 2 & 3 diagnostic bridge tests
    @PluginMethod
    public void testNativePlayback(PluginCall call) {
        playTrack(call);
    }

    @PluginMethod
    public void getNativePlayerState(PluginCall call) {
        getPlaybackState(call);
    }

    @PluginMethod
    public void testNativeSeek(PluginCall call) {
        seekTo(call);
    }

    @PluginMethod
    public void getLastCrashReport(PluginCall call) {
        try {
            Context ctx = getContext();
            if (ctx == null && getActivity() != null) ctx = getActivity().getApplicationContext();
            if (ctx != null) {
                java.io.File crashFile = new java.io.File(ctx.getFilesDir(), "stuxs_last_crash.txt");
                if (crashFile.exists() && crashFile.length() > 0) {
                    StringBuilder sb = new StringBuilder();
                    try (java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.FileReader(crashFile))) {
                        String line;
                        while ((line = reader.readLine()) != null) {
                            sb.append(line).append("\n");
                        }
                    }
                    JSObject ret = new JSObject();
                    ret.put("hasCrash", true);
                    ret.put("report", sb.toString());
                    call.resolve(ret);
                    return;
                }
            }
            JSObject ret = new JSObject();
            ret.put("hasCrash", false);
            ret.put("report", "");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to read crash log: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void testNativeStop(PluginCall call) {
        pause(call);
    }

    // ---------------------------------------------------------------------------
    // Phase 6: Chunked Offline Download Bridge
    // ---------------------------------------------------------------------------
    private final ExecutorService bridgeIoExecutor = Executors.newSingleThreadExecutor();
    private NativeChunkedDownloadManager downloadManager = null;

    private synchronized NativeChunkedDownloadManager getDownloadManager() {
        if (downloadManager == null) {
            Context ctx = getContext();
            if (ctx == null && getActivity() != null) {
                ctx = getActivity().getApplicationContext();
            }
            Context resolvedCtx = ctx != null ? ctx : (getBridge() != null ? getBridge().getContext() : null);
            NativeDownloadRepository repo = new NativeDownloadRepository(resolvedCtx, null, null);
            downloadManager = new NativeChunkedDownloadManager(repo);
        }
        return downloadManager;
    }

    private DownloadedTrackEntity parseDownloadedTrackEntity(String trackId, JSObject metadata) {
        if (metadata == null) {
            metadata = new JSObject();
        }
        String title = metadata.optString("title", "Unknown Title");
        String artist = metadata.optString("artist", metadata.optString("artistName", "Unknown Artist"));
        String album = metadata.has("album") && !metadata.isNull("album")
                ? metadata.optString("album", null)
                : (metadata.has("albumTitle") && !metadata.isNull("albumTitle") ? metadata.optString("albumTitle", null) : null);
        String artworkUrl = metadata.has("artworkUrl") && !metadata.isNull("artworkUrl")
                ? metadata.optString("artworkUrl", null)
                : (metadata.has("artwork") && !metadata.isNull("artwork") ? metadata.optString("artwork", null) : null);
        String mimeType = metadata.optString("mimeType", "audio/mpeg");
        long durationMs = metadata.optLong("durationMs", 0L);
        if (durationMs == 0L) {
            double durationSec = metadata.optDouble("duration", 0.0);
            if (durationSec > 0) durationMs = (long) (durationSec * 1000);
        }
        String provider = metadata.optString("provider", "unknown");
        long downloadedAt = metadata.optLong("downloadedAt", System.currentTimeMillis());

        return new DownloadedTrackEntity(
                trackId,
                title,
                artist,
                album,
                artworkUrl,
                "", // Will be populated by commitChunkedDownload
                mimeType,
                0L, // Will be populated by commitChunkedDownload
                durationMs,
                provider,
                downloadedAt
        );
    }

    @PluginMethod
    public void beginDownloadChunked(PluginCall call) {
        bridgeIoExecutor.execute(() -> {
            try {
                String trackId = call.getString("trackId");
                if (trackId == null || trackId.trim().isEmpty()) {
                    call.reject("trackId is required");
                    return;
                }
                String extension = call.getString("extension", "mp3");
                JSObject metadata = call.getObject("metadata");
                Boolean skipIfDownloaded = call.getBoolean("skipIfDownloaded", false);

                DownloadedTrackEntity entity = null;
                if (metadata != null) {
                    entity = parseDownloadedTrackEntity(trackId, metadata);
                }

                com.stuxs.music.nativeplayer.bridge.BeginResult result = getDownloadManager().beginDownloadBlocking(
                        trackId, extension, entity, Boolean.TRUE.equals(skipIfDownloaded)
                );

                JSObject ret = new JSObject();
                ret.put("success", result.getSuccess());
                ret.put("trackId", result.getTrackId());
                ret.put("nextExpectedChunkIndex", result.getNextExpectedChunkIndex());
                ret.put("alreadyDownloaded", result.getAlreadyDownloaded());
                if (!result.getSuccess()) {
                    ret.put("error", result.getError());
                }
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("beginDownloadChunked failed: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void nativeDownloadBegin(PluginCall call) {
        beginDownloadChunked(call);
    }

    @PluginMethod
    public void nativeDownloadAppendChunk(PluginCall call) {
        writeDownloadChunk(call);
    }

    @PluginMethod
    public void nativeDownloadCommit(PluginCall call) {
        commitDownloadChunked(call);
    }

    @PluginMethod
    public void nativeDownloadAbort(PluginCall call) {
        abortDownloadChunked(call);
    }

    @PluginMethod
    public void writeDownloadChunk(PluginCall call) {
        bridgeIoExecutor.execute(() -> {
            try {
                String trackId = call.getString("trackId");
                Integer chunkIndex = call.getInt("chunkIndex");
                String chunkData = call.getString("chunkData");
                if (chunkData == null) {
                    chunkData = call.getString("chunkBase64");
                }
                String extension = call.getString("extension", "mp3");

                if (trackId == null || trackId.trim().isEmpty()) {
                    call.reject("trackId is required");
                    return;
                }
                if (chunkIndex == null) {
                    call.reject("chunkIndex is required");
                    return;
                }
                if (chunkData == null) {
                    call.reject("chunkData / chunkBase64 is required");
                    return;
                }

                ChunkWriteResult result = getDownloadManager().writeChunkBlocking(
                        trackId, chunkIndex, chunkData, extension
                );

                JSObject ret = new JSObject();
                ret.put("success", result.getSuccess());
                ret.put("trackId", result.getTrackId());
                ret.put("acceptedChunkIndex", result.getAcceptedChunkIndex());
                ret.put("nextExpectedChunkIndex", result.getNextExpectedChunkIndex());
                ret.put("bytesWritten", result.getBytesWritten());

                if (result.getSuccess()) {
                    Boolean isLast = call.getBoolean("isLast", false);
                    JSObject metadata = call.getObject("metadata");
                    if (Boolean.TRUE.equals(isLast) && metadata != null) {
                        DownloadedTrackEntity entity = parseDownloadedTrackEntity(trackId, metadata);
                        CommitResult commitRes = getDownloadManager().commitDownloadBlocking(entity);
                        ret.put("committed", commitRes.getSuccess());
                        if (commitRes.getSuccess()) {
                            ret.put("localFilePath", commitRes.getLocalFilePath());
                            ret.put("fileSize", commitRes.getFileSize());
                        } else {
                            ret.put("commitError", commitRes.getError());
                        }
                    }
                    call.resolve(ret);
                } else {
                    ret.put("error", result.getError());
                    call.resolve(ret);
                }
            } catch (Exception e) {
                call.reject("writeDownloadChunk failed: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void commitDownloadChunked(PluginCall call) {
        bridgeIoExecutor.execute(() -> {
            try {
                String trackId = call.getString("trackId");
                if (trackId == null || trackId.trim().isEmpty()) {
                    call.reject("trackId is required");
                    return;
                }
                JSObject metadata = call.getObject("metadata");
                if (metadata == null) {
                    metadata = call.getData();
                }
                DownloadedTrackEntity entity = parseDownloadedTrackEntity(trackId, metadata);
                CommitResult commitRes = getDownloadManager().commitDownloadBlocking(entity);
                JSObject ret = new JSObject();
                ret.put("success", commitRes.getSuccess());
                ret.put("trackId", commitRes.getTrackId());
                if (commitRes.getSuccess()) {
                    ret.put("localFilePath", commitRes.getLocalFilePath());
                    ret.put("fileSize", commitRes.getFileSize());
                } else {
                    ret.put("error", commitRes.getError());
                }
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("commitDownloadChunked failed: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void abortDownloadChunked(PluginCall call) {
        bridgeIoExecutor.execute(() -> {
            try {
                String trackId = call.getString("trackId");
                if (trackId == null || trackId.trim().isEmpty()) {
                    call.reject("trackId is required");
                    return;
                }
                AbortResult abortRes = getDownloadManager().abortDownloadBlocking(trackId);
                JSObject ret = new JSObject();
                ret.put("success", abortRes.getSuccess());
                ret.put("trackId", abortRes.getTrackId());
                if (!abortRes.getSuccess()) {
                    ret.put("error", abortRes.getError());
                }
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("abortDownloadChunked failed: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void getNativeDownloadedTrackIds(PluginCall call) {
        bridgeIoExecutor.execute(() -> {
            try {
                List<String> ids = getDownloadManager().getAllTrackIdsBlocking();
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("trackIds", new JSArray(ids));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to get downloaded track IDs: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void isTrackDownloadedNatively(PluginCall call) {
        bridgeIoExecutor.execute(() -> {
            try {
                String trackId = call.getString("trackId");
                if (trackId == null || trackId.isEmpty()) {
                    call.reject("trackId is required");
                    return;
                }
                boolean downloaded = getDownloadManager().isDownloadedBlocking(trackId);
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("trackId", trackId);
                ret.put("isDownloaded", downloaded);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to check track download status: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void removeNativeDownload(PluginCall call) {
        bridgeIoExecutor.execute(() -> {
            try {
                String trackId = call.getString("trackId");
                if (trackId == null || trackId.isEmpty()) {
                    call.reject("trackId is required");
                    return;
                }
                boolean removed = getDownloadManager().removeDownloadBlocking(trackId);
                JSObject ret = new JSObject();
                ret.put("success", removed);
                ret.put("trackId", trackId);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to remove native download: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void getNativeDownloadedTracks(PluginCall call) {
        bridgeIoExecutor.execute(() -> {
            try {
                List<DownloadedTrackEntity> list = getDownloadManager().getAllDownloadedTracksBlocking();
                JSArray tracksArray = new JSArray();
                for (DownloadedTrackEntity entity : list) {
                    JSObject t = new JSObject();
                    t.put("id", entity.getId());
                    t.put("title", entity.getTitle());
                    t.put("artist", entity.getArtist());
                    t.put("album", entity.getAlbum());
                    t.put("artworkUrl", entity.getArtworkUrl());
                    t.put("localFilePath", entity.getLocalFilePath());
                    t.put("mimeType", entity.getMimeType());
                    t.put("fileSize", entity.getFileSize());
                    t.put("durationMs", entity.getDurationMs());
                    t.put("provider", entity.getProvider());
                    t.put("downloadedAt", entity.getDownloadedAt());
                    tracksArray.put(t);
                }
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("tracks", tracksArray);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to get native downloaded tracks: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void getNativeDownloadStatus(PluginCall call) {
        bridgeIoExecutor.execute(() -> {
            try {
                String trackId = call.getString("trackId");
                if (trackId == null || trackId.isEmpty()) {
                    call.reject("trackId is required");
                    return;
                }
                com.stuxs.music.nativeplayer.bridge.NativeDownloadStatus status =
                        getDownloadManager().getDownloadStatusBlocking(trackId);
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("trackId", status.getTrackId());
                ret.put("status", status.getStatus());
                ret.put("isVerified", status.isVerified());
                ret.put("expectedChunkIndex", status.getExpectedChunkIndex());
                ret.put("fileSize", status.getFileSize());
                if (status.getLocalFilePath() != null) {
                    ret.put("localFilePath", status.getLocalFilePath());
                }
                if (status.getError() != null) {
                    ret.put("error", status.getError());
                }
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to get native download status: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void purgeOrphanDownloads(PluginCall call) {
        bridgeIoExecutor.execute(() -> {
            try {
                long olderThanMs = call.getInt("olderThanMs", 10 * 60 * 1000);
                int count = getDownloadManager().purgeOrphanFilesBlocking(olderThanMs);
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("purgedCount", count);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to purge orphan downloads: " + e.getMessage(), e);
            }
        });
    }
}
