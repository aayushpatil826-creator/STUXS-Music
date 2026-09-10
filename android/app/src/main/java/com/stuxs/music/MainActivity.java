package com.stuxs.music;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaSessionPlugin.class);
        registerPlugin(NativePlaybackBridgePlugin.class);
        registerPlugin(StuxsAppUpdatePlugin.class);
        super.onCreate(savedInstanceState);

        // Configure edge-to-edge dark system bars matching STUXS #0B0B0F background
        Window window = getWindow();
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        
        int darkBg = Color.parseColor("#0B0B0F");
        window.setStatusBarColor(darkBg);
        window.setNavigationBarColor(darkBg);

        WindowInsetsControllerCompat insetsController = WindowCompat.getInsetsController(window, window.getDecorView());
        if (insetsController != null) {
            insetsController.setAppearanceLightStatusBars(false);
            insetsController.setAppearanceLightNavigationBars(false);
        }

        // Apply native WindowInsets to dynamically set CSS --safe-area-inset-top & --safe-area-inset-bottom
        ViewCompat.setOnApplyWindowInsetsListener(window.getDecorView(), (v, insets) -> {
            Insets statusBarInsets = insets.getInsets(WindowInsetsCompat.Type.statusBars());
            Insets navBarInsets = insets.getInsets(WindowInsetsCompat.Type.navigationBars());
            Insets cutoutInsets = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            
            float density = getResources().getDisplayMetrics().density;
            float safeDensity = density > 0 ? density : 1.0f;

            int topSafePx = Math.max(statusBarInsets.top, cutoutInsets.top);
            int topSafeDp = (int) (topSafePx / safeDensity);

            int bottomSafePx = Math.max(navBarInsets.bottom, cutoutInsets.bottom);
            int bottomSafeDp = (int) (bottomSafePx / safeDensity);

            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().post(() -> {
                    getBridge().getWebView().evaluateJavascript(
                        "document.documentElement.style.setProperty('--safe-area-inset-top', '" + topSafeDp + "px');" +
                        "document.documentElement.style.setProperty('--safe-area-inset-bottom', '" + bottomSafeDp + "px');",
                        null
                    );
                });
            }
            return insets;
        });

        // Request POST_NOTIFICATIONS permission on Android 13+ (API 33+) for System Media Controls / Live Activities
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 101);
            }
        }
        android.util.Log.i("STUXS_SENTINEL", "[ACTIVITY_CREATE pid=" + android.os.Process.myPid() + "]");
    }

    @Override
    public void onStart() {
        super.onStart();
        android.util.Log.i("STUXS_SENTINEL", "[ACTIVITY_START pid=" + android.os.Process.myPid() + "]");
    }

    @Override
    public void onResume() {
        super.onResume();
        android.util.Log.i("STUXS_SENTINEL", "[ACTIVITY_RESUME pid=" + android.os.Process.myPid() + "]");
    }

    @Override
    public void onPause() {
        super.onPause();
        android.util.Log.i("STUXS_SENTINEL", "[ACTIVITY_PAUSE pid=" + android.os.Process.myPid() + "]");
    }

    @Override
    public void onStop() {
        super.onStop();
        android.util.Log.i("STUXS_SENTINEL", "[ACTIVITY_STOP pid=" + android.os.Process.myPid() + "]");
    }

    @Override
    public void onDestroy() {
        android.util.Log.i("STUXS_SENTINEL", "[ACTIVITY_DESTROY pid=" + android.os.Process.myPid() + " isFinishing=" + isFinishing() + "]");
        super.onDestroy();
    }
}

