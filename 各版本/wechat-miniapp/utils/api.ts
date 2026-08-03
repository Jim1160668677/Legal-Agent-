/**
 * API 请求工具 - 封装所有接口调用
 */

// 获取全局 App 实例
const app = getApp()

interface RequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: any
  header?: Record<string, string>
  needAuth?: boolean
}

interface ApiResponse<T = any> {
  code: number
  message: string
  data: T
}

// Token 刷新状态
let isRefreshing = false
let pendingRequests: Array<{
  resolve: (value: any) => void
  reject: (reason?: any) => void
  config: RequestOptions
}> = []

/**
 * 刷新 Token
 */
async function refreshAuthToken(): Promise<string> {
  const refreshToken = wx.getStorageSync('refreshToken')
  if (!refreshToken) {
    throw new Error('No refresh token')
  }

  const res = await wx.request<ApiResponse>({
    url: `${app.globalData.apiBaseUrl}/v1/auth/refresh`,
    method: 'POST',
    data: { refreshToken },
    needAuth: false,
  }) as any

  if (res.code === 200 && res.data) {
    const { accessToken, refreshToken: newRefreshToken } = res.data
    wx.setStorageSync('token', accessToken)
    wx.setStorageSync('refreshToken', newRefreshToken)
    app.globalData.token = accessToken
    app.globalData.refreshToken = newRefreshToken
    return accessToken
  }
  throw new Error('Refresh token failed')
}

/**
 * 基础请求方法
 */
function request<T = any>(options: RequestOptions): Promise<ApiResponse<T>> {
  const {
    url,
    method = 'GET',
    data,
    header = {},
    needAuth = true,
  } = options

  const fullUrl = url.startsWith('http') ? url : `${app.globalData.apiBaseUrl}${url}`

  const authHeader: Record<string, string> = {
    'Content-Type': 'application/json',
    ...header,
  }

  if (needAuth) {
    const token = wx.getStorageSync('token')
    if (token) {
      authHeader['Authorization'] = `Bearer ${token}`
    }
  }

  return new Promise((resolve, reject) => {
    wx.request<ApiResponse<T>>({
      url: fullUrl,
      method,
      data,
      header: authHeader,
      success: (res) => {
        if (res.statusCode === 200) {
          const apiRes = res.data as ApiResponse<T>
          if (apiRes.code === 200 || apiRes.code === 0) {
            resolve(apiRes)
          } else if (apiRes.code === 401) {
            // Token 过期，尝试刷新
            handleTokenExpired(resolve, reject, options)
          } else {
            reject(new Error(apiRes.message || 'Request failed'))
          }
        } else if (res.statusCode === 401) {
          handleTokenExpired(resolve, reject, options)
        } else {
          reject(new Error(`HTTP ${res.statusCode}`))
        }
      },
      fail: (err) => {
        reject(err)
      },
    })
  })
}

/**
 * 处理 Token 过期
 */
function handleTokenExpired<T>(
  resolve: (value: ApiResponse<T>) => void,
  reject: (reason?: any) => void,
  config: RequestOptions,
) {
  if (!isRefreshing) {
    isRefreshing = true
    refreshAuthToken()
      .then((newToken) => {
        isRefreshing = false
        // 重试所有等待的请求
        pendingRequests.forEach(({ resolve: r, config: c }) => {
          r(executeRequest(c))
        })
        pendingRequests = []
        // 重试当前请求
        resolve(executeRequest(config) as Promise<ApiResponse<T>>)
      })
      .catch(() => {
        isRefreshing = false
        pendingRequests.forEach(({ reject: r }) => r(new Error('Login expired')))
        pendingRequests = []
        reject(new Error('Login expired'))
        // 清除登录状态
        app.logout()
        wx.reLaunch({ url: '/pages/login/login' })
      })
  } else {
    // 正在刷新，加入等待队列
    pendingRequests.push({ resolve, reject, config })
  }
}

/**
 * 执行请求
 */
function executeRequest(config: RequestOptions): any {
  return new Promise((resolve, reject) => {
    const { url, method = 'GET', data, header = {}, needAuth = true } = config
    const fullUrl = url.startsWith('http') ? url : `${app.globalData.apiBaseUrl}${url}`

    const authHeader: Record<string, string> = {
      'Content-Type': 'application/json',
      ...header,
    }

    if (needAuth) {
      const token = wx.getStorageSync('token')
      if (token) {
        authHeader['Authorization'] = `Bearer ${token}`
      }
    }

    wx.request({
      url: fullUrl,
      method,
      data,
      header: authHeader,
      success: (res) => {
        if (res.statusCode === 200) {
          const apiRes = res.data as ApiResponse
          if (apiRes.code === 200 || apiRes.code === 0) {
            resolve(apiRes)
          } else {
            reject(new Error(apiRes.message || 'Request failed'))
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`))
        }
      },
      fail: (err) => reject(err),
    })
  })
}

// ==================== API 接口封装 ====================

export const api = {
  // 认证相关
  login: (username: string, password: string) =>
    request('/v1/auth/login', { method: 'POST', data: { username, password }, needAuth: false }),

  logout: () => request('/v1/auth/logout', { method: 'POST' }),

  // 会话相关
  createSession: (intent?: string) =>
    request('/v1/chat/sessions', { method: 'POST', data: { intent } }),

  getSessionList: (page = 1, pageSize = 20) =>
    request(`/v1/chat/sessions?page=${page}&pageSize=${pageSize}`),

  getSessionMessages: (sessionId: string, page = 1, pageSize = 20) =>
    request(`/v1/chat/sessions/${sessionId}/messages?page=${page}&pageSize=${pageSize}`),

  sendMessage: (sessionId: string, content: string, messageType = 'text') =>
    request(`/v1/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      data: { content, messageType },
    }),

  deleteSession: (sessionId: string) =>
    request(`/v1/chat/sessions/${sessionId}`, { method: 'DELETE' }),

  // 知识检索
  searchKnowledge: (query: string, filters?: any, topK = 10) =>
    request('/v1/knowledge/retrieve', {
      method: 'POST',
      data: { query, filters, topK },
    }),

  // 上传
  uploadFile: (filePath: string) => {
    return new Promise<{ url: string }>((resolve, reject) => {
      const token = wx.getStorageSync('token')
      wx.uploadFile({
        url: `${app.globalData.apiBaseUrl}/v1/upload`,
        filePath,
        name: 'file',
        header: { Authorization: `Bearer ${token}` },
        success: (res) => {
          try {
            const data = JSON.parse(res.data) as ApiResponse
            if (data.code === 200) {
              resolve(data.data as { url: string })
            } else {
              reject(new Error(data.message))
            }
          } catch {
            reject(new Error('Upload failed'))
          }
        },
        fail: reject,
      })
    })
  },
}

export default api
