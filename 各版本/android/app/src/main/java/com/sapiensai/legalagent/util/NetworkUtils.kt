package com.sapiensai.legalagent.util

import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object NetworkUtils {
    private const val CONNECT_TIMEOUT = 30L
    private const val READ_TIMEOUT = 60L
    private const val WRITE_TIMEOUT = 60L

    private val loggingInterceptor = HttpLoggingInterceptor().apply {
        level = HttpLoggingInterceptor.Level.BODY
    }

    private val authInterceptor = Interceptor { chain ->
        val original = chain.request()
        val token = StorageUtils.getAccessToken()
        val requestBuilder = original.newBuilder()
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
        if (!token.isNullOrEmpty()) {
            requestBuilder.header("Authorization", "Bearer $token")
        }
        chain.proceed(requestBuilder.build())
    }

    private val okHttpClient = OkHttpClient.Builder()
        .connectTimeout(CONNECT_TIMEOUT, TimeUnit.SECONDS)
        .readTimeout(READ_TIMEOUT, TimeUnit.SECONDS)
        .writeTimeout(WRITE_TIMEOUT, TimeUnit.SECONDS)
        .addInterceptor(loggingInterceptor)
        .addInterceptor(authInterceptor)
        .build()

    val api: LegalAgentApi by lazy {
        Retrofit.Builder()
            .baseUrl(Constants.API_BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(LegalAgentApi::class.java)
    }
}

object StorageUtils {
    private fun getPrefs() =
        com.sapiensai.legalagent.MainActivity().applicationContext
            .getSharedPreferences(Constants.PREFS_NAME, android.content.Context.MODE_PRIVATE)

    fun saveAccessToken(token: String) {
        getPrefs().edit().putString(Constants.KEY_ACCESS_TOKEN, token).apply()
    }

    fun getAccessToken(): String? = getPrefs().getString(Constants.KEY_ACCESS_TOKEN, null)

    fun saveRefreshToken(token: String) {
        getPrefs().edit().putString(Constants.KEY_REFRESH_TOKEN, token).apply()
    }

    fun getRefreshToken(): String? = getPrefs().getString(Constants.KEY_REFRESH_TOKEN, null)

    fun saveUser(id: String, username: String) {
        getPrefs().edit()
            .putString(Constants.KEY_USER_ID, id)
            .putString(Constants.KEY_USERNAME, username)
            .putBoolean(Constants.KEY_IS_LOGGED_IN, true)
            .apply()
    }

    fun clearAuth() {
        getPrefs().edit()
            .remove(Constants.KEY_ACCESS_TOKEN)
            .remove(Constants.KEY_REFRESH_TOKEN)
            .remove(Constants.KEY_USER_ID)
            .remove(Constants.KEY_USERNAME)
            .putBoolean(Constants.KEY_IS_LOGGED_IN, false)
            .apply()
    }

    fun isLoggedIn(): Boolean = getPrefs().getBoolean(Constants.KEY_IS_LOGGED_IN, false)

    fun getUsername(): String? = getPrefs().getString(Constants.KEY_USERNAME, null)

    fun getUserId(): String? = getPrefs().getString(Constants.KEY_USER_ID, null)
}
