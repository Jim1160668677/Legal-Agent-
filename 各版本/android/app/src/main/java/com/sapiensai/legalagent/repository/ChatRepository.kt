package com.sapiensai.legalagent.repository

import com.sapiensai.legalagent.data.model.ChatMessage
import com.sapiensai.legalagent.data.model.ChatSession
import com.sapiensai.legalagent.data.model.SendMessageRequest
import com.sapiensai.legalagent.data.remote.ApiResponse
import com.sapiensai.legalagent.data.remote.LegalAgentApi
import com.sapiensai.legalagent.util.Constants
import com.sapiensai.legalagent.util.StorageUtils
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ChatRepository @Inject constructor(
    private val api: LegalAgentApi
) {
    private val token: String?
        get() = StorageUtils.getAccessToken()?.let { "Bearer $it" }

    suspend fun getSessions(page: Int = 1, pageSize: Int = Constants.DEFAULT_PAGE_SIZE): ApiResponse<List<ChatSession>> {
        return try {
            val auth = token ?: return ApiResponse.Error("未登录")
            val response = api.getSessions(auth, page, pageSize)
            if (response.success && response.data != null) {
                ApiResponse.Success(response.data.sessions)
            } else {
                ApiResponse.Error(response.message ?: "获取会话失败")
            }
        } catch (e: Exception) {
            ApiResponse.Error(e.message ?: "网络错误")
        }
    }

    suspend fun createSession(intent: String): ApiResponse<ChatSession> {
        return try {
            val auth = token ?: return ApiResponse.Error("未登录")
            val response = api.createSession(auth, mapOf("intent" to intent))
            if (response.success && response.data != null) {
                ApiResponse.Success(response.data)
            } else {
                ApiResponse.Error(response.message ?: "创建会话失败")
            }
        } catch (e: Exception) {
            ApiResponse.Error(e.message ?: "网络错误")
        }
    }

    suspend fun getMessages(sessionId: String, page: Int = 1, pageSize: Int = Constants.DEFAULT_PAGE_SIZE): ApiResponse<List<ChatMessage>> {
        return try {
            val auth = token ?: return ApiResponse.Error("未登录")
            val response = api.getMessages(auth, sessionId, page, pageSize)
            if (response.success && response.data != null) {
                ApiResponse.Success(response.data)
            } else {
                ApiResponse.Error(response.message ?: "获取消息失败")
            }
        } catch (e: Exception) {
            ApiResponse.Error(e.message ?: "网络错误")
        }
    }

    suspend fun sendMessage(sessionId: String, content: String): ApiResponse<ChatMessage> {
        return try {
            val auth = token ?: return ApiResponse.Error("未登录")
            val response = api.sendMessage(auth, sessionId, SendMessageRequest(content))
            if (response.success && response.data != null) {
                ApiResponse.Success(response.data)
            } else {
                ApiResponse.Error(response.message ?: "发送消息失败")
            }
        } catch (e: Exception) {
            ApiResponse.Error(e.message ?: "网络错误")
        }
    }

    suspend fun deleteSession(sessionId: String): ApiResponse<Unit> {
        return try {
            val auth = token ?: return ApiResponse.Error("未登录")
            val response = api.deleteSession(auth, sessionId)
            if (response.success) {
                ApiResponse.Success(Unit)
            } else {
                ApiResponse.Error(response.message ?: "删除会话失败")
            }
        } catch (e: Exception) {
            ApiResponse.Error(e.message ?: "网络错误")
        }
    }
}
