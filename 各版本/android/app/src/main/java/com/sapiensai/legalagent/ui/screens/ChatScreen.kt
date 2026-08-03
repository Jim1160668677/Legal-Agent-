package com.sapiensai.legalagent.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.sapiensai.legalagent.ui.components.LoadingIndicator
import com.sapiensai.legalagent.ui.components.MessageBubble
import com.sapiensai.legalagent.viewmodel.ChatViewModel
import com.sapiensai.legalagent.util.DateUtils

@Composable
fun ChatScreen(viewModel: ChatViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    var messageText by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    LaunchedEffect(uiState.messages.size) {
        if (uiState.messages.isNotEmpty()) {
            listState.scrollToItem(uiState.messages.size)
        }
    }

    LaunchedEffect(Unit) {
        viewModel.loadSessions()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("智能对话") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = MaterialTheme.colorScheme.onPrimary
                )
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            if (uiState.currentSessionId == null) {
                // 显示会话列表
                SessionList(
                    sessions = uiState.sessions,
                    onSelect = { viewModel.selectSession(it) },
                    isLoading = uiState.isLoading
                )
            } else {
                // 显示消息列表
                if (uiState.isLoading && uiState.messages.isEmpty()) {
                    LoadingIndicator()
                } else {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        contentPadding = PaddingValues(vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        items(uiState.messages) { message ->
                            MessageBubble(
                                content = message.content,
                                isUser = message.role == "user",
                                modifier = Modifier.fillMaxWidth()
                            )
                            if (message.role == "assistant") {
                                Text(
                                    text = DateUtils.formatTime(message.timestamp),
                                    modifier = Modifier
                                        .align(Alignment.End)
                                        .padding(end = 16.dp),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                        if (uiState.isSending) {
                            item {
                                LoadingIndicator(modifier = Modifier.padding(16.dp))
                            }
                        }
                    }
                }

                // 输入框
                Surface(
                    shadowElevation = 4.dp
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 8.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.Bottom
                    ) {
                        OutlinedTextField(
                            value = messageText,
                            onValueChange = { messageText = it },
                            modifier = Modifier
                                .weight(1f)
                                .heightIn(min = 48.dp, max = 120.dp),
                            placeholder = { Text("输入您的法律问题...") },
                            maxLines = 4
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        FloatingActionButton(
                            onClick = {
                                if (messageText.isNotBlank() && uiState.currentSessionId != null) {
                                    viewModel.sendMessage(uiState.currentSessionId, messageText)
                                    messageText = ""
                                }
                            },
                            enabled = messageText.isNotBlank() && !uiState.isSending && uiState.currentSessionId != null,
                            modifier = Modifier.height(48.dp)
                        ) {
                            if (uiState.isSending) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(24.dp),
                                    color = MaterialTheme.colorScheme.onPrimary,
                                    strokeWidth = 2.dp
                                )
                            } else {
                                androidx.compose.material.icons.Icons.Filled.Send
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SessionList(
    sessions: List<com.sapiensai.legalagent.data.model.ChatSession>,
    onSelect: (String) -> Unit,
    isLoading: Boolean
) {
    if (isLoading) {
        LoadingIndicator()
    } else if (sessions.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("暂无会话", style = MaterialTheme.typography.bodyLarge)
                Spacer(modifier = Modifier.height(8.dp))
                Button(onClick = { /* 创建新会话 */ }) {
                    Text("开始新对话")
                }
            }
        }
    } else {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(sessions) { session ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onSelect(session.id) },
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant
                    )
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp)
                    ) {
                        Text(
                            text = session.title ?: "新会话",
                            style = MaterialTheme.typography.titleMedium
                        )
                        if (session.updatedAt > 0) {
                            Text(
                                text = DateUtils.formatTime(session.updatedAt),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
    }
}
