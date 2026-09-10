package com.stuxs.music.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import com.stuxs.music.ui.theme.StuxsTheme
import com.stuxs.music.ui.viewmodel.NativePlayerViewModel

/**
 * Standalone diagnostic Activity for testing the native Jetpack Compose UI
 * and native Media3 playback without interfering with the existing WebView player.
 */
class NativeMusicActivity : ComponentActivity() {

    private val playerViewModel: NativePlayerViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            StuxsTheme {
                StuxsAppContent(viewModel = playerViewModel)
            }
        }
    }
}
