package com.stuxs.music;

import android.app.Application;
import android.util.Log;
import java.io.File;
import java.io.FileWriter;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class StuxsApplication extends Application {
    private static final String TAG = "STUXS_SENTINEL";

    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "=== STUXS_SENTINEL [APP_CREATE pid=" + android.os.Process.myPid() + "] ===");

        final Thread.UncaughtExceptionHandler defaultHandler = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            String timestamp = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).format(new Date());
            StringWriter sw = new StringWriter();
            PrintWriter pw = new PrintWriter(sw);
            throwable.printStackTrace(pw);
            String stackTrace = sw.toString();

            String crashReport = "==================== STUXS FATAL CRASH REPORT ====================\n"
                    + "Timestamp: " + timestamp + "\n"
                    + "PID: " + android.os.Process.myPid() + "\n"
                    + "Thread: " + thread.getName() + " (id=" + thread.getId() + ")\n"
                    + "Exception: " + throwable.getClass().getName() + ": " + throwable.getMessage() + "\n"
                    + "Stacktrace:\n" + stackTrace + "\n"
                    + "=================================================================\n";

            Log.e(TAG, crashReport);

            try {
                File crashFile = new File(getFilesDir(), "stuxs_last_crash.txt");
                try (FileWriter writer = new FileWriter(crashFile, false)) {
                    writer.write(crashReport);
                    writer.flush();
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to persist crash report to disk: " + e.getMessage());
            }

            if (defaultHandler != null) {
                defaultHandler.uncaughtException(thread, throwable);
            }
        });
    }
}
