package com.stuxs.music.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val StuxsDarkColorScheme = darkColorScheme(
    primary = StuxsAccent,
    onPrimary = StuxsText,
    primaryContainer = StuxsSurfaceSecondary,
    onPrimaryContainer = StuxsText,
    secondary = StuxsAccent,
    onSecondary = StuxsText,
    background = StuxsBg,
    onBackground = StuxsText,
    surface = StuxsSurface,
    onSurface = StuxsText,
    surfaceVariant = StuxsSurfaceSecondary,
    onSurfaceVariant = StuxsTextSecondary,
    outline = StuxsBorder,
    outlineVariant = StuxsBorderLight,
    error = StuxsError,
    onError = StuxsText
)

@Composable
fun StuxsTheme(
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = StuxsDarkColorScheme,
        content = content
    )
}
