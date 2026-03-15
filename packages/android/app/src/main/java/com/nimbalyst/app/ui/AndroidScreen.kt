package com.nimbalyst.app.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Settings
import androidx.compose.ui.graphics.vector.ImageVector

enum class AndroidScreen(val label: String, val icon: ImageVector) {
    Projects("Projects", Icons.Default.Folder),
    Sessions("Sessions", Icons.Default.ChatBubble),
    Settings("Settings", Icons.Default.Settings),
}
