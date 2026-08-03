package com.sapiensai.legalagent.data.remote

import com.sapiensai.legalagent.data.model.*
import retrofit2.http.*

interface LegalAgentApi {
    @POST("/v1/auth/login")
    suspend fun login(@Body request: LoginRequest): ApiResponseWrapper<LoginResponse>

    @POST("/v1/auth/refresh")
    suspend fun refreshToken(@Body request: RefreshTokenRequest): ApiResponseWrapper<LoginResponse>

    @POST("/v1/auth/logout")
    suspend fun logout(@Header("Authorization") authorization: String): ApiResponseWrapper<Unit>

    @GET("/v1/chat/sessions")
    suspend fun getSessions(
        @Header("Authorization") authorization: String,
        @Query("page") page: Int,
        @Query("pageSize") pageSize: Int
    ): ApiResponseWrapper<SessionListResponse>

    @POST("/v1/chat/sessions")
    suspend fun createSession(
        @Header("Authorization") authorization: String,
        @Body intent: Map<String, String>
    ): ApiResponseWrapper<ChatSession>

    @POST("/v1/chat/sessions/{sessionId}/messages")
    suspend fun sendMessage(
        @Header("Authorization") authorization: String,
        @Path("sessionId") sessionId: String,
        @Body message: SendMessageRequest
    ): ApiResponseWrapper<ChatMessage>

    @GET("/v1/chat/sessions/{sessionId}/messages")
    suspend fun getMessages(
        @Header("Authorization") authorization: String,
        @Path("sessionId") sessionId: String,
        @Query("page") page: Int,
        @Query("pageSize") pageSize: Int
    ): ApiResponseWrapper<List<ChatMessage>>

    @DELETE("/v1/chat/sessions/{sessionId}")
    suspend fun deleteSession(
        @Header("Authorization") authorization: String,
        @Path("sessionId") sessionId: String
    ): ApiResponseWrapper<Unit>

    @POST("/v1/knowledge/retrieve")
    suspend fun searchKnowledge(
        @Header("Authorization") authorization: String,
        @Body request: KnowledgeRequest
    ): ApiResponseWrapper<List<KnowledgeResult>>

    @POST("/v1/cases/analyze")
    suspend fun analyzeCase(
        @Header("Authorization") authorization: String,
        @Body request: AnalysisRequest
    ): ApiResponseWrapper<AnalysisResult>
}

data class ApiResponseWrapper<T>(
    val success: Boolean,
    val data: T? = null,
    val message: String? = null,
    val code: Int? = null
)

data class KnowledgeRequest(
    val query: String,
    val category: String? = null,
    val topK: Int = 5
)
