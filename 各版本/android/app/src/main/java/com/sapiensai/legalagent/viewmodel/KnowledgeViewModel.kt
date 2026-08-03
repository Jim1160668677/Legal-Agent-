package com.sapiensai.legalagent.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sapiensai.legalagent.data.model.KnowledgeResult
import com.sapiensai.legalagent.data.remote.ApiResponse
import com.sapiensai.legalagent.repository.KnowledgeRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class KnowledgeUiState(
    val query: String = "",
    val results: List<KnowledgeResult> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class KnowledgeViewModel @Inject constructor(
    private val knowledgeRepository: KnowledgeRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(KnowledgeUiState())
    val uiState: StateFlow<KnowledgeUiState> = _uiState.asStateFlow()

    fun search(query: String, category: String? = null) {
        if (query.isBlank()) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            when (val result = knowledgeRepository.searchKnowledge(query, category)) {
                is ApiResponse.Success -> {
                    _uiState.value = _uiState.value.copy(
                        results = result.data,
                        isLoading = false
                    )
                }
                is ApiResponse.Error -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = result.message
                    )
                }
                is ApiResponse.Loading -> {}
            }
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
