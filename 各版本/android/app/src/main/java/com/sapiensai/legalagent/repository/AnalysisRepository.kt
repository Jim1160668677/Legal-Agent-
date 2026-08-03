package com.sapiensai.legalagent.repository

import com.sapiensai.legalagent.data.model.AnalysisRequest
import com.sapiensai.legalagent.data.model.AnalysisResult
import com.sapiensai.legalagent.data.remote.ApiResponse
import com.sapiensai.legalagent.data.remote.LegalAgentApi
import com.sapiensai.legalagent.util.StorageUtils
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AnalysisRepository @Inject constructor(
    private val api: LegalAgentApi
) {
    private val token: String?
        get() = StorageUtils.getAccessToken()?.let { "Bearer $it" }

    suspend fun analyzeCase(caseType: String, facts: String): ApiResponse<AnalysisResult> {
        return try {
            val auth = token ?: return ApiResponse.Error("未登录")
            val response = api.analyzeCase(auth, AnalysisRequest(caseType, facts))
            if (response.success && response.data != null) {
                ApiResponse.Success(response.data)
            } else {
                ApiResponse.Error(response.message ?: "分析失败")
            }
        } catch (e: Exception) {
            ApiResponse.Error(e.message ?: "网络错误")
        }
    }
}
