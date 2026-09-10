package com.stuxs.music.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.stuxs.music.ui.theme.*

enum class NavDestination {
    HOME,
    SEARCH,
    LIBRARY
}

@Composable
fun StuxsBottomNav(
    currentDestination: NavDestination,
    onNavigate: (NavDestination) -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(StuxsBg)
            .border(width = 1.dp, color = StuxsBorder)
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceAround,
        verticalAlignment = Alignment.CenterVertically
    ) {
        NavItem(
            icon = Icons.Default.Home,
            label = "Home",
            selected = currentDestination == NavDestination.HOME,
            onClick = { onNavigate(NavDestination.HOME) }
        )
        NavItem(
            icon = Icons.Default.Search,
            label = "Search",
            selected = currentDestination == NavDestination.SEARCH,
            onClick = { onNavigate(NavDestination.SEARCH) }
        )
        NavItem(
            icon = Icons.Default.LibraryMusic,
            label = "Library",
            selected = currentDestination == NavDestination.LIBRARY,
            onClick = { onNavigate(NavDestination.LIBRARY) }
        )
    }
}

@Composable
private fun NavItem(
    icon: ImageVector,
    label: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    Column(
        modifier = Modifier
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = if (selected) StuxsAccent else StuxsTextMuted,
            modifier = Modifier.size(24.dp)
        )
        Spacer(modifier = Modifier.height(3.dp))
        Text(
            text = label,
            color = if (selected) StuxsAccent else StuxsTextMuted,
            fontSize = 11.sp
        )
    }
}
