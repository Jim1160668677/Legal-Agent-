package com.sapiensai.legalagent.repository

import com.sapiensai.legalagent.data.model.KnowledgeRequest
import com.sapiensai.legalagent.data.model.KnowledgeResult
import com.sapiensai.legalagent.data.remote.ApiResponse
import com.sapiensai.legalagent.data.remote.LegalAgentApi
import com.sapiensai.legalagent.util.Constants
import com.sapiensai.legalagent.util.StorageUtils
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class KnowledgeRepository @Inject constructor(
    private val api: LegalAgentApi
) {
    private val token: String?
        get() = StorageUtils.getAccessToken()?.let { "Bearer $it" }

    suspend fun searchKnowledge(query: String, category: String? = null): ApiResponse<List<KnowledgeResult>> {
        return try {
            val auth = token ?: return ApiResponse.Error("未登录")
            val response = api.searchKnowledge(auth, KnowledgeRequest(query, category, Constants.DEFAULT_TOP_K))
            if (response.success && response.data != null) {
                ApiResponse.Success(response.data)
            } else {
                ApiResponse.Error(response.message ?: "检索失败")
            }
        } catch (e: Exception) {
            ApiResponse.Error(e.message ?: "网络错误")
        }
    }
}
