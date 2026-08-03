package com.sapiensai.legalagent.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.navigation.compose.*
import com.sapiensai.legalagent.ui.theme.LegalAgentTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            LegalAgentTheme {
                LegalAgentNavGraph()
            }
        }
    }
}

@Composable
fun LegalAgentNavGraph() {
    val navController = rememberNavController()
    
    Scaffold(
        bottomBar = {
            BottomNavigation {
                BottomNavigationItem(
                    icon = { Icon(Icons.Default.Message, contentDescription = null) },
                    label = { Text("对话") },
                    selected = navController.currentBackStackEntry?.destination?.route == "chat",
                    onClick = { navController.navigate("chat") }
                )
                BottomNavigationItem(
                    icon = { Icon(Icons.Default.Description, contentDescription = null) },
                    label = { Text("分析") },
                    selected = navController.currentBackStackEntry?.destination?.route == "analysis",
                    onClick = { navController.navigate("analysis") }
                )
                BottomNavigationItem(
                    icon = { Icon(Icons.Default.MenuBook, contentDescription = null) },
                    label = { Text("知识") },
                    selected = navController.currentBackStackEntry?.destination?.route == "knowledge",
                    onClick = { navController.navigate("knowledge") }
                )
                BottomNavigationItem(
                    icon = { Icon(Icons.Default.Person, contentDescription = null) },
                    label = { Text("我的") },
                    selected = navController.currentBackStackEntry?.destination?.route == "profile",
                    onClick = { navController.navigate("profile") }
                )
            }
        }
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = "chat",
            modifier = Modifier.padding(padding)
        ) {
            composable("chat") { ChatScreen() }
            composable("analysis") { AnalysisScreen() }
            composable("knowledge") { KnowledgeScreen() }
            composable("profile") { ProfileScreen() }
        }
    }
}

@Composable
fun ChatScreen() {
    Column(modifier = Modifier.fillMaxSize()) {
        Text("聊天页面 - 待实现完整UI", modifier = Modifier.fillMaxSize(), textAlign = TextAlign.Center)
    }
}

@Composable
fun AnalysisScreen() {
    Column(modifier = Modifier.fillMaxSize()) {
        Text("案件分析页面 - 待实现完整UI", modifier = Modifier.fillMaxSize(), textAlign = TextAlign.Center)
    }
}

@Composable
fun KnowledgeScreen() {
    Column(modifier = Modifier.fillMaxSize()) {
        Text("法律知识页面 - 待实现完整UI", modifier = Modifier.fillMaxSize(), textAlign = TextAlign.Center)
    }
}

@Composable
fun ProfileScreen() {
    Column(modifier = Modifier.fillMaxSize()) {
        Text("个人中心页面 - 待实现完整UI", modifier = Modifier.fillMaxSize(), textAlign = TextAlign.Center)
    }
}
