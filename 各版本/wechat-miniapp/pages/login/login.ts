// pages/login/login.ts
const app = getApp()

Page({
  data: {
    username: '',
    password: '',
    loading: false,
    remember: false,
    agreed: false,
    statusBarHeight: 0,
  },

  onLoad() {
    const systemInfo = wx.getSystemInfoSync()
    this.setData({ statusBarHeight: systemInfo.statusBarHeight })

    // 检查是否有记住的账号
    const savedUsername = wx.getStorageSync('savedUsername')
    const savedPassword = wx.getStorageSync('savedPassword')
    const remember = wx.getStorageSync('remember')
    if (remember === 'true' && savedUsername) {
      this.setData({
        username: savedUsername,
        password: savedPassword || '',
        remember: true,
      })
    }
  },

  onUsernameInput(e: any) {
    this.setData({ username: e.detail.value })
  },

  onPasswordInput(e: any) {
    this.setData({ password: e.detail.value })
  },

  onRememberChange(e: any) {
    this.setData({ remember: e.detail.value.length > 0 })
  },

  onAgreeChange(e: any) {
    this.setData({ agreed: e.detail.value.length > 0 })
  },

  onForgotPassword() {
    wx.showToast({ title: '请联系管理员重置密码', icon: 'none' })
  },

  onViewAgreement() {
    wx.navigateTo({ url: '/pages/webview/webview?url=' + encodeURIComponent('https://example.com/agreement') })
  },

  onViewPrivacy() {
    wx.navigateTo({ url: '/pages/webview/webview?url=' + encodeURIComponent('https://example.com/privacy') })
  },

  async onLogin() {
    const { username, password, remember, agreed } = this.data

    if (!username.trim()) {
      wx.showToast({ title: '请输入用户名', icon: 'none' })
      return
    }
    if (!password.trim()) {
      wx.showToast({ title: '请输入密码', icon: 'none' })
      return
    }
    if (!agreed) {
      wx.showToast({ title: '请先同意用户协议和隐私政策', icon: 'none' })
      return
    }

    this.setData({ loading: true })

    try {
      const res = await app.$api.login(username.trim(), password.trim())
      if (res.data) {
        // 保存登录信息
        app.login(res.data)
        if (remember) {
          wx.setStorageSync('savedUsername', username)
          wx.setStorageSync('savedPassword', password)
          wx.setStorageSync('remember', 'true')
        } else {
          wx.removeStorageSync('savedUsername')
          wx.removeStorageSync('savedPassword')
          wx.removeStorageSync('remember')
        }
        wx.showToast({ title: '登录成功', icon: 'success' })
        setTimeout(() => {
          wx.switchTab({ url: '/pages/chat/chat' })
        }, 1000)
      }
    } catch (error: any) {
      wx.showToast({ title: error.message || '登录失败', icon: 'error' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async onWechatLogin() {
    if (!this.data.agreed) {
      wx.showToast({ title: '请先同意用户协议和隐私政策', icon: 'none' })
      return
    }

    this.setData({ loading: true })

    try {
      // 获取微信登录凭证
      const wxRes = await new Promise<any>((resolve, reject) => {
        wx.login({ success: resolve, fail: reject })
      })

      if (!wxRes.code) {
        throw new Error('获取登录凭证失败')
      }

      // 调用后端微信登录接口
      const res = await app.$api.wechatLogin(wxRes.code)
      if (res.data) {
        app.login(res.data)
        wx.showToast({ title: '登录成功', icon: 'success' })
        setTimeout(() => {
          wx.switchTab({ url: '/pages/chat/chat' })
        }, 1000)
      }
    } catch (error: any) {
      wx.showToast({ title: error.message || '登录失败', icon: 'error' })
    } finally {
      this.setData({ loading: false })
    }
  },
})
