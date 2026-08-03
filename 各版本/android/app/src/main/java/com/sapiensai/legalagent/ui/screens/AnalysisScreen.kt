package com.sapiensai.legalagent.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.sapiensai.legalagent.ui.components.CaseTypeSelector
import com.sapiensai.legalagent.ui.components.LoadingIndicator
import com.sapiensai.legalagent.viewmodel.AnalysisViewModel
import com.sapiensai.legalagent.util.Constants

@Composable
fun AnalysisScreen(viewModel: AnalysisViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("案件分析") },
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
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
        ) {
            // 案件类型选择
            Text(
                text = "案件类型",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(bottom = 8.dp)
            )
            CaseTypeSelector(
                selectedType = uiState.caseType,
                onTypeSelected = { viewModel.updateCaseType(it) }
            )
            Spacer(modifier = Modifier.height(16.dp))

            // 案件事实输入
            Text(
                text = "案件事实",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(bottom = 8.dp)
            )
            OutlinedTextField(
                value = uiState.facts,
                onValueChange = { viewModel.updateFacts(it) },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(200.dp),
                placeholder = { Text("请详细描述案件事实，包括时间、地点、当事人、争议焦点等...") },
                maxLines = 10
            )
            Spacer(modifier = Modifier.height(16.dp))

            // 分析按钮
            Button(
                onClick = { viewModel.analyze() },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp),
                enabled = !uiState.isLoading && uiState.caseType.isNotEmpty() && uiState.facts.isNotEmpty()
            ) {
                if (uiState.isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                        strokeWidth = 2.dp
                    )
                } else {
                    Text("开始分析")
                }
            }
            Spacer(modifier = Modifier.height(16.dp))

            // 错误提示
            uiState.error?.let { error ->
                Text(
                    text = error,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall
                )
                Spacer(modifier = Modifier.height(8.dp))
            }

            // 分析结果
            if (uiState.result != null) {
                AnalysisResultCard(result = uiState.result!!)
            } else if (uiState.isLoading) {
                LoadingIndicator()
            }
        }
    }
}

@Composable
private fun AnalysisResultCard(result: com.sapiensai.legalagent.data.model.AnalysisResult) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            Text(
                text = "分析结果",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(12.dp))

            // 案件摘要
            ResultSection(title = "案件摘要", content = result.summary)
            Spacer(modifier = Modifier.height(12.dp))

            // 风险评估
            ResultSection(
                title = "风险评估",
                content = "风险等级: ${result.riskLevel} (${String.format("%.1f", result.riskScore * 100)}%)"
            )
            Spacer(modifier = Modifier.height(12.dp))

            // 法律依据
            if (result.legalBasis.isNotEmpty()) {
                ResultSection(title = "法律依据", content = result.legalBasis.joinToString("\n"))
                Spacer(modifier = Modifier.height(12.dp))
            }

            // 法律建议
            ResultSection(title = "法律建议", content = result.advice)
            Spacer(modifier = Modifier.height(12.dp))

            // 建议措施
            if (result.suggestedActions.isNotEmpty()) {
                ResultSection(
                    title = "建议措施",
                    content = result.suggestedActions.joinToString("\n") { "- $it" }
                )
            }
        }
    }
}

@Composable
private fun ResultSection(title: String, content: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.Medium,
        color = MaterialTheme.colorScheme.primary
    )
    Spacer(modifier = Modifier.height(4.dp))
    Text(
        text = content,
        style = MaterialTheme.typography.bodyMedium
    )
}
