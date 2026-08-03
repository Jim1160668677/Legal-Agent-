package com.sapiensai.legalagent.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.sapiensai.legalagent.ui.components.LoadingIndicator
import com.sapiensai.legalagent.ui.components.SearchBar
import com.sapiensai.legalagent.viewmodel.KnowledgeViewModel
import com.sapiensai.legalagent.util.Constants

@Composable
fun KnowledgeScreen(viewModel: KnowledgeViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    var searchQuery by remember { mutableStateOf("") }
    var showCategories by remember { mutableStateOf(false) }

    val categories = listOf("全部", "民事", "刑事", "商事", "行政", "劳动", "房产", "合同")
    var selectedCategory by remember { mutableStateOf("全部") }

    LaunchedEffect(searchQuery) {
        // 防抖搜索
        kotlinx.coroutines.delay(500)
        if (searchQuery.isNotBlank()) {
            viewModel.search(searchQuery, if (selectedCategory == "全部") null else selectedCategory)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("法律知识") },
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
                .padding(16.dp)
        ) {
            // 搜索栏
            SearchBar(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                onSearch = {
                    if (searchQuery.isNotBlank()) {
                        viewModel.search(searchQuery, if (selectedCategory == "全部") null else selectedCategory)
                    }
                },
                placeholder = "搜索法律法规..."
            )
            Spacer(modifier = Modifier.height(8.dp))

            // 分类筛选
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "分类: $selectedCategory",
                    style = MaterialTheme.typography.bodyMedium
                )
                if (uiState.isLoading) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp))
                }
            }
            Spacer(modifier = Modifier.height(12.dp))

            // 结果列表
            if (uiState.results.isEmpty() && !uiState.isLoading) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = androidx.compose.ui.Alignment.Center
                ) {
                    Text("输入关键词搜索法律知识", style = MaterialTheme.typography.bodyLarge)
                }
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(uiState.results) { result ->
                        KnowledgeResultCard(result = result)
                    }
                    if (uiState.results.isNotEmpty()) {
                        item {
                            Spacer(modifier = Modifier.height(16.dp))
                            Text(
                                text = "共 ${uiState.results.size} 条结果",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.align(androidx.compose.ui.Alignment.End)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun KnowledgeResultCard(result: com.sapiensai.legalagent.data.model.KnowledgeResult) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = result.title,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 2
                )
                Text(
                    text = String.format("%.1f", result.relevanceScore * 100) + "%",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = result.content,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 4
            )
            Spacer(modifier = Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Chipy(selected = false, onClick = {}) {
                    Text(result.category)
                }
                if (!result.source.isNullOrEmpty()) {
                    Text(
                        text = result.source,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

@Composable
private fun Chipy(
    selected: Boolean,
    onClick: () -> Unit,
    content: @Composable () -> Unit
) {
    Surface(
        onClick = onClick,
        color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.outlineVariant,
        shape = MaterialTheme.shapes.small
    ) {
        Padding(values = PaddingValues(horizontal = 12.dp, vertical = 4.dp)) {
            content()
        }
    }
}
