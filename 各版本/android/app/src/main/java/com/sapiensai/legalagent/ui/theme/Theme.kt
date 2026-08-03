package com.sapiensai.legalagent.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val LightColorScheme = lightColorScheme(
    primary = Color(0xFF1B5E20),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFF9CF1A0),
    onPrimaryContainer = Color(0xFF002106),
    secondary = Color(0xFF5E5F5E),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFE2E3E2),
    onSecondaryContainer = Color(0xFF1B1B1B),
    tertiary = Color(0xFF3F5992),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFD8E2FF),
    onTertiaryContainer = Color(0xFF001A43),
    error = Color(0xFFB3261E),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFDEDCD),
    onErrorContainer = Color(0xFF410E0B),
    background = Color(0xFFFDFDF7),
    onBackground = Color(0xFF1A1C18),
    surface = Color(0xFFFDFDF7),
    onSurface = Color(0xFF1A1C18),
    surfaceVariant = Color(0xFFE1E3D8),
    onSurfaceVariant = Color(0xFF44483F),
    outline = Color(0xFF74796E),
    outlineVariant = Color(0xFFC4C7BA),
    scrim = Color(0xFF000000),
    inverseSurface = Color(0xFF2F312C),
    inverseOnSurface = Color(0xFFF4F4EE),
    inversePrimary = Color(0xFF81D387),
    surfaceDim = Color(0xFFDEDCC8),
    surfaceBright = Color(0xFFFDFDF7),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF7F8F1),
    surfaceContainer = Color(0xFFF1F2EB),
    surfaceContainerHigh = Color(0xFFEBECE5),
    surfaceContainerHighest = Color(0xFFE6E7E0)
)

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFF81D387),
    onPrimary = Color(0xFF00390B),
    primaryContainer = Color(0xFF005214),
    onPrimaryContainer = Color(0xFF9CF1A0),
    secondary = Color(0xFFC6C7C6),
    onSecondary = Color(0xFF303130),
    secondaryContainer = Color(0xFF414241),
    onSecondaryContainer = Color(0xFFE2E3E2),
    tertiary = Color(0xFFADBCEF),
    onTertiary = Color(0xFF0A2F60),
    tertiaryContainer = Color(0xFF264178),
    onTertiaryContainer = Color(0xFFD8E2FF),
    error = Color(0xFFF2B8B5),
    onError = Color(0xFF601410),
    errorContainer = Color(0xFF8C1D18),
    onErrorContainer = Color(0xFFFDEDCD),
    background = Color(0xFF1A1C18),
    onBackground = Color(0xFFE3E3DC),
    surface = Color(0xFF1A1C18),
    onSurface = Color(0xFFE3E3DC),
    surfaceVariant = Color(0xFF44483F),
    onSurfaceVariant = Color(0xFFC4C7BA),
    outline = Color(0xFF8E9289),
    outlineVariant = Color(0xFF44483F),
    scrim = Color(0xFF000000),
    inverseSurface = Color(0xFFE3E3DC),
    inverseOnSurface = Color(0xFF2F312C),
    inversePrimary = Color(0xFF1B5E20),
    surfaceDim = Color(0xFF1A1C18),
    surfaceBright = Color(0xFF41433D),
    surfaceContainerLowest = Color(0xFF151713),
    surfaceContainerLow = Color(0xFF232520),
    surfaceContainer = Color(0xFF272924),
    surfaceContainerHigh = Color(0xFF31342E),
    surfaceContainerHighest = Color(0xFF3C3F38)
)

@Composable
fun LegalAgentTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = AppTypography,
        content = content
    )
}
