package com.sapiensai.legalagent.data.model

data class User(
    val id: String,
    val username: String,
    val role: String,
    val email: String? = null,
    val avatarUrl: String? = null
)

data class LoginRequest(
    val username: String,
    val password: String
)

data class LoginResponse(
    val accessToken: String,
    val refreshToken: String,
    val user: User
)

data class RefreshTokenRequest(
    val refreshToken: String
)

data class ChatMessage(
    val id: String,
    val sessionId: String,
    val role: String,
    val content: String,
    val type: String = "text",
    val timestamp: Long = System.currentTimeMillis()
)

data class ChatSession(
    val id: String,
    val title: String?,
    val intent: String?,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
)

data class SessionListResponse(
    val sessions: List<ChatSession>,
    val total: Int,
    val page: Int,
    val pageSize: Int
)

data class SendMessageRequest(
    val content: String,
    val messageType: String = "user"
)

data class KnowledgeResult(
    val id: String,
    val title: String,
    val content: String,
    val category: String,
    val relevanceScore: Double,
    val source: String? = null,
    val createdAt: Long = System.currentTimeMillis()
)

data class AnalysisRequest(
    val caseType: String,
    val facts: String,
    val additionalInfo: Map<String, String> = emptyMap()
)

data class AnalysisResult(
    val caseType: String,
    val summary: String,
    val riskLevel: String,
    val riskScore: Double,
    val legalBasis: List<String>,
    val advice: String,
    val suggestedActions: List<String>,
    val confidence: Double
)
