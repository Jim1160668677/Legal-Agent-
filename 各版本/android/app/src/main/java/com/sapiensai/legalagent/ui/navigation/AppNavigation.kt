package com.sapiensai.legalagent.ui.navigation

import android.annotation.SuppressLint
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.sapiensai.legalagent.ui.screens.AnalysisScreen
import com.sapiensai.legalagent.ui.screens.ChatScreen
import com.sapiensai.legalagent.ui.screens.KnowledgeScreen
import com.sapiensai.legalagent.ui.screens.LoginScreen
import com.sapiensai.legalagent.ui.screens.ProfileScreen
import com.sapiensai.legalagent.util.Constants
import com.sapiensai.legalagent.util.StorageUtils
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*

sealed class Screen(val route: String, val title: String, val icon: ImageVector) {
    data object Chat : Screen(Constants.Navigation.CHAT, "对话", Icons.Default.Chat)
    data object Analysis : Screen(Constants.Navigation.ANALYSIS, "分析", Icons.Default.Description)
    data object Knowledge : Screen(Constants.Navigation.KNOWLEDGE, "知识", Icons.Default.MenuBook)
    data object Profile : Screen(Constants.Navigation.PROFILE, "我的", Icons.Default.Person)
    data object Login : Screen(Constants.Navigation.LOGIN, "登录", Icons.Outlined.Login)
}

@Composable
fun AppNavigation() {
    val navController = rememberNavController()
    val isLoggedIn = StorageUtils.isLoggedIn()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    val bottomNavItems = listOf(
        Screen.Chat,
        Screen.Analysis,
        Screen.Knowledge,
        Screen.Profile
    )

    if (isLoggedIn) {
        Scaffold(
            bottomBar = {
                NavigationBar {
                    bottomNavItems.forEach { screen ->
                        NavigationItem(
                            screen = screen,
                            isSelected = currentRoute == screen.route,
                            onClick = { navController.navigate(screen.route) { popUpTo(Constants.Navigation.CHAT) { launchSingleTop = true } } }
                        )
                    }
                }
            }
        ) { padding ->
            NavHost(
                navController = navController,
                startDestination = Constants.Navigation.CHAT,
                modifier = Modifier.padding(padding)
            ) {
                composableScreen(Screen.Chat) { ChatScreen() }
                composableScreen(Screen.Analysis) { AnalysisScreen() }
                composableScreen(Screen.Knowledge) { KnowledgeScreen() }
                composableScreen(Screen.Profile) { ProfileScreen() }
            }
        }
    } else {
        NavHost(
            navController = navController,
            startDestination = Constants.Navigation.LOGIN,
        ) {
            composableScreen(Screen.Login) { LoginScreen(navController = navController) }
        }
    }
}

@Suppress("UNCHECKED_CAST")
private inline fun <reified T : Any> NavGraphBuilder.composableScreen(screen: T, content: @Composable () -> Unit) {
    val route = (screen as? Screen)?.route ?: return
    composable(route) { content() }
}

@Composable
private fun NavigationItem(
    screen: Screen,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    NavigationItem(
        selected = isSelected,
        onClick = onClick,
        icon = {
            Icon(
                imageVector = if (isSelected) screen.icon else Icons.Outlined.getIcon(screen.route),
                contentDescription = screen.title
            )
        },
        label = { Text(screen.title) }
    )
}

private fun Icons.Outlined.getIcon(route: String): ImageVector = when (route) {
    Constants.Navigation.CHAT -> Icons.Outlined.Chat
    Constants.Navigation.ANALYSIS -> Icons.Outlined.Description
    Constants.Navigation.KNOWLEDGE -> Icons.Outlined.MenuBook
    Constants.Navigation.PROFILE -> Icons.Outlined.Person
    else -> Icons.Outlined.HelpOutline
}
