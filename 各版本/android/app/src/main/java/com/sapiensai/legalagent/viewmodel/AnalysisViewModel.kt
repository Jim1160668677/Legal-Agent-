package com.sapiensai.legalagent.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sapiensai.legalagent.data.model.AnalysisResult
import com.sapiensai.legalagent.data.remote.ApiResponse
import com.sapiensai.legalagent.repository.AnalysisRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AnalysisUiState(
    val caseType: String = "",
    val facts: String = "",
    val result: AnalysisResult? = null,
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class AnalysisViewModel @Inject constructor(
    private val analysisRepository: AnalysisRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(AnalysisUiState())
    val uiState: StateFlow<AnalysisUiState> = _uiState.asStateFlow()

    fun updateCaseType(caseType: String) {
        _uiState.value = _uiState.value.copy(caseType = caseType)
    }

    fun updateFacts(facts: String) {
        _uiState.value = _uiState.value.copy(facts = facts)
    }

    fun analyze() {
        val state = _uiState.value
        if (state.caseType.isEmpty() || state.facts.isEmpty()) return

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            when (val result = analysisRepository.analyzeCase(state.caseType, state.facts)) {
                is ApiResponse.Success -> {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        result = result.data
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

    fun reset() {
        _uiState.value = AnalysisUiState()
    }
}
