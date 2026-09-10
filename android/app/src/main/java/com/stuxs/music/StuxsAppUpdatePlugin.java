package com.stuxs.music;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;

@CapacitorPlugin(name = "StuxsAppUpdate")
public class StuxsAppUpdatePlugin extends Plugin {

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AtomicBoolean isDownloading = new AtomicBoolean(false);
    private final AtomicBoolean cancelRequested = new AtomicBoolean(false);
    private PluginCall activeDownloadCall = null;
    private File currentDownloadFile = null;

    @PluginMethod
    public void getAppVersionInfo(PluginCall call) {
        try {
            Context ctx = getContext();
            PackageManager pm = ctx.getPackageManager();
            PackageInfo pInfo = pm.getPackageInfo(ctx.getPackageName(), 0);

            long versionCode;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                versionCode = pInfo.getLongVersionCode();
            } else {
                versionCode = pInfo.versionCode;
            }

            JSObject ret = new JSObject();
            ret.put("versionName", pInfo.versionName != null ? pInfo.versionName : "1.0.0");
            ret.put("versionCode", versionCode);
            ret.put("packageName", ctx.getPackageName());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to retrieve package information: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void checkInstallPermission(PluginCall call) {
        Context ctx = getContext();
        boolean canInstall = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            canInstall = ctx.getPackageManager().canRequestPackageInstalls();
        }
        JSObject ret = new JSObject();
        ret.put("canInstall", canInstall);
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        try {
            Context ctx = getContext();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + ctx.getPackageName())
                );
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
                JSObject ret = new JSObject();
                ret.put("opened", true);
                call.resolve(ret);
            } else {
                JSObject ret = new JSObject();
                ret.put("opened", false);
                call.resolve(ret);
            }
        } catch (Exception e) {
            call.reject("Could not open install unknown apps settings: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void downloadApk(PluginCall call) {
        String apkUrl = call.getString("apkUrl");
        String expectedSha256 = call.getString("sha256");

        if (apkUrl == null || !apkUrl.startsWith("https://")) {
            call.reject("APK URL must use secure HTTPS protocol", "INVALID_URL");
            return;
        }

        if (expectedSha256 == null || expectedSha256.trim().length() != 64) {
            call.reject("Expected SHA-256 hash must be a valid 64-character hex string", "INVALID_HASH");
            return;
        }

        if (!isDownloading.compareAndSet(false, true)) {
            call.reject("An APK download is already in progress", "DOWNLOAD_IN_PROGRESS");
            return;
        }

        cancelRequested.set(false);
        activeDownloadCall = call;

        executor.execute(() -> {
            HttpsURLConnection conn = null;
            InputStream in = null;
            FileOutputStream out = null;
            File tempFile = null;

            try {
                Context ctx = getContext();
                File updatesDir = new File(ctx.getCacheDir(), "updates");
                if (!updatesDir.exists() && !updatesDir.mkdirs()) {
                    throw new IllegalStateException("Failed to create updates directory");
                }

                // Clean up any stale partial files
                File targetFile = new File(updatesDir, "stuxs_update.apk");
                if (targetFile.exists()) {
                    targetFile.delete();
                }

                tempFile = new File(updatesDir, "stuxs_update.tmp");
                if (tempFile.exists()) {
                    tempFile.delete();
                }
                currentDownloadFile = tempFile;

                URL url = new URL(apkUrl);
                conn = (HttpsURLConnection) url.openConnection();
                conn.setConnectTimeout(15000); // 15s connection establishment timeout
                conn.setReadTimeout(15000);    // 15s inactivity socket read timeout
                conn.setRequestProperty("User-Agent", "STUXS-Music-InAppUpdater/1.0");
                conn.connect();

                int responseCode = conn.getResponseCode();
                int redirectCount = 0;
                while ((responseCode == 301 || responseCode == 302 || responseCode == 303 || responseCode == 307 || responseCode == 308) && redirectCount < 5) {
                    String location = conn.getHeaderField("Location");
                    if (location == null || location.trim().isEmpty()) {
                        break;
                    }
                    URL nextUrl = new URL(url, location);
                    if (!nextUrl.getProtocol().equalsIgnoreCase("https")) {
                        throw new SecurityException("Insecure redirect protocol rejected: " + nextUrl.getProtocol());
                    }
                    conn.disconnect();
                    url = nextUrl;
                    conn = (HttpsURLConnection) url.openConnection();
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(15000);
                    conn.setRequestProperty("User-Agent", "STUXS-Music-InAppUpdater/1.0");
                    conn.connect();
                    responseCode = conn.getResponseCode();
                    redirectCount++;
                }

                if (responseCode < 200 || responseCode >= 300) {
                    throw new IllegalStateException("Server returned HTTP " + responseCode);
                }

                long totalBytes = conn.getContentLengthLong();
                in = conn.getInputStream();
                out = new FileOutputStream(tempFile);
                MessageDigest digest = MessageDigest.getInstance("SHA-256");

                byte[] buffer = new byte[32 * 1024]; // 32KB buffer for optimal streaming
                long bytesDownloaded = 0;
                long lastProgressTime = 0;
                int bytesRead;

                while ((bytesRead = in.read(buffer)) != -1) {
                    if (cancelRequested.get()) {
                        throw new InterruptedException("Download cancelled by user");
                    }

                    out.write(buffer, 0, bytesRead);
                    digest.update(buffer, 0, bytesRead);
                    bytesDownloaded += bytesRead;

                    long now = System.currentTimeMillis();
                    if (now - lastProgressTime > 150 || bytesDownloaded == totalBytes) {
                        lastProgressTime = now;
                        int percent = totalBytes > 0 ? (int) ((bytesDownloaded * 100) / totalBytes) : 0;
                        JSObject progress = new JSObject();
                        progress.put("percent", Math.min(100, Math.max(0, percent)));
                        progress.put("bytesDownloaded", bytesDownloaded);
                        progress.put("totalBytes", totalBytes > 0 ? totalBytes : bytesDownloaded);
                        notifyListeners("downloadProgress", progress);
                    }
                }

                out.flush();
                out.close();
                out = null;

                in.close();
                in = null;

                // Verify SHA-256
                byte[] hashBytes = digest.digest();
                StringBuilder sb = new StringBuilder();
                for (byte b : hashBytes) {
                    sb.append(String.format("%02x", b));
                }
                String computedSha256 = sb.toString();

                if (!computedSha256.equalsIgnoreCase(expectedSha256.trim())) {
                    if (tempFile != null && tempFile.exists()) {
                        tempFile.delete();
                    }
                    throw new SecurityException("SHA-256 checksum mismatch! Expected: " + expectedSha256 + " Computed: " + computedSha256);
                }

                // Rename verified temp file to target APK
                if (!tempFile.renameTo(targetFile)) {
                    throw new IllegalStateException("Failed to commit verified update APK");
                }
                currentDownloadFile = targetFile;

                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("filePath", targetFile.getAbsolutePath());
                ret.put("sha256", computedSha256);
                ret.put("sizeBytes", targetFile.length());

                mainHandler.post(() -> {
                    if (activeDownloadCall != null) {
                        activeDownloadCall.resolve(ret);
                        activeDownloadCall = null;
                    }
                });

            } catch (InterruptedException ie) {
                if (tempFile != null && tempFile.exists()) tempFile.delete();
                mainHandler.post(() -> {
                    if (activeDownloadCall != null) {
                        activeDownloadCall.reject("Download was cancelled", "CANCELLED");
                        activeDownloadCall = null;
                    }
                });
            } catch (Exception e) {
                if (tempFile != null && tempFile.exists()) tempFile.delete();
                mainHandler.post(() -> {
                    if (activeDownloadCall != null) {
                        activeDownloadCall.reject("Download failed: " + e.getMessage(), "DOWNLOAD_ERROR", e);
                        activeDownloadCall = null;
                    }
                });
            } finally {
                isDownloading.set(false);
                try { if (in != null) in.close(); } catch (Exception ignored) {}
                try { if (out != null) out.close(); } catch (Exception ignored) {}
                if (conn != null) conn.disconnect();
            }
        });
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        if (isDownloading.get()) {
            cancelRequested.set(true);
            if (currentDownloadFile != null && currentDownloadFile.exists()) {
                currentDownloadFile.delete();
            }
            call.resolve(new JSObject().put("cancelled", true));
        } else {
            call.resolve(new JSObject().put("cancelled", false));
        }
    }

    private String calculateFileSha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream fis = new java.io.FileInputStream(file)) {
            byte[] buffer = new byte[32 * 1024];
            int n;
            while ((n = fis.read(buffer)) != -1) {
                digest.update(buffer, 0, n);
            }
        }
        byte[] hash = digest.digest();
        StringBuilder sb = new StringBuilder();
        for (byte b : hash) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        try {
            Context ctx = getContext();
            File updatesDir = new File(ctx.getCacheDir(), "updates");
            File apkFile = new File(updatesDir, "stuxs_update.apk");

            String customPath = call.getString("filePath");
            if (customPath != null && !customPath.isEmpty()) {
                File customFile = new File(customPath);
                if (customFile.exists()) {
                    apkFile = customFile;
                }
            }

            // 1. Verify APK file exists and can be read
            if (!apkFile.exists() || !apkFile.canRead()) {
                call.reject("Downloaded update APK does not exist or cannot be read", "FILE_NOT_FOUND");
                return;
            }

            // 2. Verify APK size is valid (0 < size <= 150MB)
            long apkLength = apkFile.length();
            if (apkLength <= 0 || apkLength > 150 * 1024 * 1024) {
                call.reject("Downloaded update APK size is invalid: " + apkLength + " bytes", "INVALID_SIZE");
                return;
            }

            // 3. Verify SHA-256 matches manifest if provided
            String expectedSha256 = call.getString("sha256");
            if (expectedSha256 != null && !expectedSha256.trim().isEmpty()) {
                String actualSha256 = calculateFileSha256(apkFile);
                if (!actualSha256.equalsIgnoreCase(expectedSha256.trim())) {
                    apkFile.delete();
                    call.reject("APK SHA-256 checksum mismatch! Expected: " + expectedSha256 + " but got: " + actualSha256, "CHECKSUM_MISMATCH");
                    return;
                }
            }

            // 4. Verify the archive is a valid Android package
            PackageManager pm = ctx.getPackageManager();
            PackageInfo archiveInfo = pm.getPackageArchiveInfo(apkFile.getAbsolutePath(), 0);
            if (archiveInfo == null) {
                call.reject("File is corrupted or is not a valid Android APK archive", "INVALID_ARCHIVE");
                return;
            }

            // 5. Verify package name is strictly com.stuxs.music and matches current app package
            if (!"com.stuxs.music".equals(archiveInfo.packageName) || !ctx.getPackageName().equals(archiveInfo.packageName)) {
                call.reject("Package name mismatch: " + archiveInfo.packageName + " does not match com.stuxs.music", "PACKAGE_MISMATCH");
                return;
            }

            // 6. Verify APK versionCode is strictly greater than installed versionCode
            PackageInfo installedInfo = pm.getPackageInfo(ctx.getPackageName(), 0);
            long installedVersionCode;
            long archiveVersionCode;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                installedVersionCode = installedInfo.getLongVersionCode();
                archiveVersionCode = archiveInfo.getLongVersionCode();
            } else {
                installedVersionCode = installedInfo.versionCode;
                archiveVersionCode = archiveInfo.versionCode;
            }

            if (archiveVersionCode <= installedVersionCode) {
                call.reject("Update APK versionCode (" + archiveVersionCode + ") must be greater than installed versionCode (" + installedVersionCode + ")", "VERSION_DOWNGRADE");
                return;
            }

            // 7. Generate secure FileProvider content:// URI (Android signature verification is left to PackageInstaller)
            Uri contentUri = FileProvider.getUriForFile(
                ctx,
                ctx.getPackageName() + ".fileprovider",
                apkFile
            );

            // Create Android standard PackageInstaller ACTION_VIEW intent
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            ctx.startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("started", true);
            ret.put("uri", contentUri.toString());
            call.resolve(ret);

        } catch (Exception e) {
            call.reject("Failed to launch package installer: " + e.getMessage(), "INSTALL_LAUNCH_FAILED", e);
        }
    }

    @PluginMethod
    public void cleanupApk(PluginCall call) {
        try {
            Context ctx = getContext();
            File updatesDir = new File(ctx.getCacheDir(), "updates");
            File apkFile = new File(updatesDir, "stuxs_update.apk");
            File tmpFile = new File(updatesDir, "stuxs_update.tmp");
            boolean deleted = false;
            if (apkFile.exists()) deleted |= apkFile.delete();
            if (tmpFile.exists()) deleted |= tmpFile.delete();
            call.resolve(new JSObject().put("cleaned", deleted));
        } catch (Exception e) {
            call.reject("Failed to clean up update files: " + e.getMessage(), e);
        }
    }
}
