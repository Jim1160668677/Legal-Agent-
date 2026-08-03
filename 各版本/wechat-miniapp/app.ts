/**
 * 微信小程序版本 - App配置
 */
App({
  globalData: {
    userInfo: null,
    token: null,
    refreshToken: null,
    apiBaseUrl: 'https://api.legal-agent.com',
  },

  onLaunch() {
    // 检查登录状态
    this.checkLoginStatus()
  },

  checkLoginStatus() {
    const token = wx.getStorageSync('token')
    const refreshToken = wx.getStorageSync('refreshToken')
    if (token) {
      this.globalData.token = token
      this.globalData.refreshToken = refreshToken
      this.validateToken()
    }
  },

  validateToken() {
    // 验证token有效性
    wx.request({
      url: `${this.globalData.apiBaseUrl}/v1/auth/validate`,
      method: 'GET',
      header: {
        Authorization: `Bearer ${this.globalData.token}`,
      },
      success: (res) => {
        if (res.statusCode !== 200) {
          this.logout()
        }
      },
      fail: () => {
        this.logout()
      },
    })
  },

  login(userInfo: any) {
    this.globalData.userInfo = userInfo
    wx.setStorageSync('userInfo', userInfo)
    wx.setStorageSync('token', userInfo.token)
    wx.setStorageSync('refreshToken', userInfo.refreshToken)
  },

  logout() {
    this.globalData.userInfo = null
    this.globalData.token = null
    this.globalData.refreshToken = null
    wx.removeStorageSync('userInfo')
    wx.removeStorageSync('token')
    wx.removeStorageSync('refreshToken')
  },
})
