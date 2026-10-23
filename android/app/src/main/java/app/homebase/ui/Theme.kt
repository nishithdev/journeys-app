package app.homebase.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import app.homebase.TileIcons
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.homebase.HomeApp

val Ground = Color(0xFFF3F4F8)
val Ink = Color(0xFF14171F)
val Muted = Color(0xFF4A5163)
val Faint = Color(0xFF5B6274)
val Line = Color(0xFFE3E6EE)
val Accent = Color(0xFF3F5EFB)
val Good = Color(0xFF1E9E63)
val GoodSoft = Color(0xFFE4F4EC)
val Warn = Color(0xFF8A3D08)
val WarnSoft = Color(0xFFFFF1E6)
val Bad = Color(0xFFC2372B)
val BadSoft = Color(0xFFFDECEA)

@Composable
fun HomebaseTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Accent, onPrimary = Color.White, background = Ground, onBackground = Ink,
            surface = Color.White, onSurface = Ink, onSurfaceVariant = Muted, outline = Color(0xFFD5D9E3),
        ),
        content = content,
    )
}

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Button(
        onClick = onClick, enabled = enabled, shape = RoundedCornerShape(28.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Accent),
        modifier = modifier.fillMaxWidth().height(56.dp),
    ) { Text(text, fontSize = 16.sp, fontWeight = FontWeight.Bold) }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, color: Color = Ink) {
    OutlinedButton(
        onClick = onClick, shape = RoundedCornerShape(24.dp),
        border = BorderStroke(1.dp, if (color == Ink) Color(0xFFD5D9E3) else color.copy(alpha = 0.35f)),
        modifier = modifier.fillMaxWidth().height(48.dp),
    ) { Text(text, color = color, fontSize = 14.sp, fontWeight = FontWeight.Bold) }
}

@Composable
fun Panel(modifier: Modifier = Modifier, padding: PaddingValues = PaddingValues(16.dp), content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Color.White)
            .border(1.dp, Line, RoundedCornerShape(20.dp)).padding(padding),
        verticalArrangement = Arrangement.spacedBy(10.dp), content = content,
    )
}

@Composable
fun SectionLabel(text: String) {
    Text(text.uppercase(), fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, color = Faint, letterSpacing = 0.7.sp)
}

@Composable
fun StatusDot(color: Color, halo: Color) {
    Box(Modifier.size(18.dp).clip(CircleShape).background(halo), contentAlignment = Alignment.Center) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(color))
    }
}

/** An app's square icon: the server's color with a matching symbol, or its first letter. */
@Composable
fun AppIcon(app: HomeApp, size: Dp = 52.dp) {
    val ctx = LocalContext.current
    // A picture from the server (e.g. Life Quest's pixel trophy), drawn without smoothing so pixel art stays crisp.
    val picture by produceState(initialValue = app.iconUrl.takeIf { it.isNotBlank() }?.let { TileIcons.cached(ctx, it) }, app.iconUrl) {
        if (app.iconUrl.isNotBlank()) value = TileIcons.load(ctx, app.iconUrl)
    }
    Box(
        Modifier.size(size).clip(RoundedCornerShape(size * 0.3f)).background(Color(app.color)),
        contentAlignment = Alignment.Center,
    ) {
        val icon = when (app.icon) {
            "journeys" -> Icons.Filled.DateRange
            "home", "home-assistant" -> Icons.Filled.Home
            "star", "quest" -> Icons.Filled.Star
            else -> null
        }
        val bmp = picture
        when {
            bmp != null -> Image(
                bmp.asImageBitmap(), contentDescription = null, filterQuality = FilterQuality.None,
                modifier = Modifier.size(size * 0.78f),
            )
            icon != null -> Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(size * 0.54f))
            else -> Text(app.name.take(1).uppercase(), color = Color.White, fontSize = (size.value * 0.42f).sp, fontWeight = FontWeight.ExtraBold)
        }
    }
}

@Composable
fun ScreenColumn(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxSize().background(Ground).padding(horizontal = 22.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp), content = content,
    )
}
