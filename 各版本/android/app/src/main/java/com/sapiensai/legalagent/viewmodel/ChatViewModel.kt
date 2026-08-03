package com.sapiensai.legalagent.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sapiensai.legalagent.data.model.ChatMessage
import com.sapiensai.legalagent.data.model.ChatSession
import com.sapiensai.legalagent.data.remote.ApiResponse
import com.sapiensai.legalagent.repository.ChatRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ChatUiState(
    val sessions: List<ChatSession> = emptyList(),
    val messages: List<ChatMessage> = emptyList(),
    val isLoading: Boolean = false,
    val isSending: Boolean = false,
    val error: String? = null,
    val currentSessionId: String? = null
)

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val chatRepository: ChatRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    fun loadSessions() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            when (val result = chatRepository.getSessions()) {
                is ApiResponse.Success -> {
                    _uiState.value = _uiState.value.copy(
                        sessions = result.data,
                        isLoading = false
                    )
                }
                is ApiResponse.Error -> {
                    _uiState.value = _uiState.value.copy(isLoading = false, error = result.message)
                }
                is ApiResponse.Loading -> {}
            }
        }
    }

    fun selectSession(sessionId: String) {
        _uiState.value = _uiState.value.copy(currentSessionId = sessionId)
        loadMessages(sessionId)
    }

    fun createNewSession(intent: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            when (val result = chatRepository.createSession(intent)) {
                is ApiResponse.Success -> {
                    val newSession = result.data
                    _uiState.value = _uiState.value.copy(
                        sessions = listOf(newSession) + _uiState.value.sessions,
                        currentSessionId = newSession.id,
                        isLoading = false
                    )
                    loadMessages(newSession.id)
                }
                is ApiResponse.Error -> {
                    _uiState.value = _uiState.value.copy(isLoading = false, error = result.message)
                }
                is ApiResponse.Loading -> {}
            }
        }
    }

    fun loadMessages(sessionId: String) {
        viewModelScope.launch {
            when (val result = chatRepository.getMessages(sessionId)) {
                is ApiResponse.Success -> {
                    _uiState.value = _uiState.value.copy(messages = result.data)
                }
                is ApiResponse.Error -> {
                    _uiState.value = _uiState.value.copy(error = result.message)
                }
                is ApiResponse.Loading -> {}
            }
        }
    }

    fun sendMessage(sessionId: String, content: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isSending = true)
            val userMessage = ChatMessage(
                id = "user_${System.currentTimeMillis()}",
                sessionId = sessionId,
                role = "user",
                content = content,
                timestamp = System.currentTimeMillis()
            )
            val currentMessages = _uiState.value.messages + userMessage
            _uiState.value = _uiState.value.copy(messages = currentMessages, isSending = true)

            when (val result = chatRepository.sendMessage(sessionId, content)) {
                is ApiResponse.Success -> {
                    val assistantMessage = ChatMessage(
                        id = result.data.id,
                        sessionId = sessionId,
                        role = "assistant",
                        content = result.data.content,
                        timestamp = System.currentTimeMillis()
                    )
                    _uiState.value = _uiState.value.copy(
                        messages = currentMessages + assistantMessage,
                        isSending = false
                    )
                }
                is ApiResponse.Error -> {
                    _uiState.value = _uiState.value.copy(
                        isSending = false,
                        error = result.message
                    )
                }
                is ApiResponse.Loading -> {}
            }
        }
    }

    fun deleteSession(sessionId: String) {
        viewModelScope.launch {
            when (val result = chatRepository.deleteSession(sessionId)) {
                is ApiResponse.Success -> {
                    _uiState.value = _uiState.value.copy(
                        sessions = _uiState.value.sessions.filter { it.id != sessionId }
                    )
                    if (_uiState.value.currentSessionId == sessionId) {
                        _uiState.value = _uiState.value.copy(currentSessionId = null, messages = emptyList())
                    }
                }
                is ApiResponse.Error -> {}
                is ApiResponse.Loading -> {}
            }
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
