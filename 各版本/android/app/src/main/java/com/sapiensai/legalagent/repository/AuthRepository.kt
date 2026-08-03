package com.sapiensai.legalagent.repository

import com.sapiensai.legalagent.data.model.LoginRequest
import com.sapiensai.legalagent.data.model.LoginResponse
import com.sapiensai.legalagent.data.model.RefreshTokenRequest
import com.sapiensai.legalagent.data.remote.ApiResponse
import com.sapiensai.legalagent.data.remote.LegalAgentApi
import com.sapiensai.legalagent.util.StorageUtils
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val api: LegalAgentApi
) {
    suspend fun login(username: String, password: String): ApiResponse<LoginResponse> {
        return try {
            val response = api.login(LoginRequest(username, password))
            if (response.success && response.data != null) {
                StorageUtils.saveAccessToken(response.data.accessToken)
                StorageUtils.saveRefreshToken(response.data.refreshToken)
                StorageUtils.saveUser(response.data.user.id, response.data.user.username)
                ApiResponse.Success(response.data)
            } else {
                ApiResponse.Error(response.message ?: "登录失败")
            }
        } catch (e: Exception) {
            ApiResponse.Error(e.message ?: "网络错误")
        }
    }

    suspend fun logout(): ApiResponse<Unit> {
        val token = StorageUtils.getAccessToken() ?: return ApiResponse.Success(Unit)
        return try {
            api.logout("Bearer $token")
            StorageUtils.clearAuth()
            ApiResponse.Success(Unit)
        } catch (e: Exception) {
            StorageUtils.clearAuth()
            ApiResponse.Error(e.message ?: "登出失败")
        }
    }

    suspend fun refreshToken(): ApiResponse<LoginResponse> {
        val refreshToken = StorageUtils.getRefreshToken() ?: return ApiResponse.Error("无刷新token")
        return try {
            val response = api.refreshToken(RefreshTokenRequest(refreshToken))
            if (response.success && response.data != null) {
                StorageUtils.saveAccessToken(response.data.accessToken)
                StorageUtils.saveRefreshToken(response.data.refreshToken)
                ApiResponse.Success(response.data)
            } else {
                StorageUtils.clearAuth()
                ApiResponse.Error(response.message ?: "刷新token失败")
            }
        } catch (e: Exception) {
            StorageUtils.clearAuth()
            ApiResponse.Error(e.message ?: "网络错误")
        }
    }
}
