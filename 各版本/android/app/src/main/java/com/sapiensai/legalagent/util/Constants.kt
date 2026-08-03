package com.sapiensai.legalagent.util

object Constants {
    const val API_BASE_URL = "http://10.0.2.2:8000"
    const val AUTH_HEADER = "Authorization"
    const val TOKEN_PREFIX = "Bearer "

    const val PREFS_NAME = "legal_agent_prefs"
    const val KEY_ACCESS_TOKEN = "access_token"
    const val KEY_REFRESH_TOKEN = "refresh_token"
    const val KEY_USER_ID = "user_id"
    const val KEY_USERNAME = "username"
    const val KEY_IS_LOGGED_IN = "is_logged_in"

    const val DEFAULT_PAGE_SIZE = 20
    const val DEFAULT_TOP_K = 5

    object ApiEndpoints {
        const val LOGIN = "/v1/auth/login"
        const val REFRESH = "/v1/auth/refresh"
        const val LOGOUT = "/v1/auth/logout"
        const val SESSIONS = "/v1/chat/sessions"
        const val MESSAGES = "/v1/chat/sessions/%s/messages"
        const val KNOWLEDGE_RETRIEVE = "/v1/knowledge/retrieve"
        const val CASES_ANALYZE = "/v1/cases/analyze"
    }

    object CaseTypes {
        const val CIVIL = "民事"
        const val CRIMINAL = "刑事"
        const val COMMERCIAL = "商事"
        const val ADMINISTRATIVE = "行政"
        const val LABOR = "劳动"
        const val PROPERTY = "房产"
        const val CONTRACT = "合同"
        const val OTHER = "其他"
    }

    object Navigation {
        const val LOGIN = "login"
        const val CHAT = "chat"
        const val ANALYSIS = "analysis"
        const val KNOWLEDGE = "knowledge"
        const val PROFILE = "profile"
    }
}
