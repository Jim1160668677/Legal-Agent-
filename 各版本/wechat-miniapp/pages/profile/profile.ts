// pages/profile/profile.ts
const app = getApp()
const { api } = require('../../utils/api')

Page({
  data: {
    userInfo: null,
  },

  onLoad() {
    this.loadUserInfo()
  },

  onShow() {
    this.loadUserInfo()
  },

  async loadUserInfo() {
    const userInfo = app.globalData.userInfo
    if (userInfo) {
      this.setData({ userInfo })
    } else {
      wx.redirectTo({ url: '/pages/login/login' })
    }
  },

  editProfile() {
    wx.showToast({ title: '编辑资料功能开发中', icon: 'none' })
  },

  viewMySessions() {
    wx.switchTab({ url: '/pages/chat/chat' })
  },

  viewFavorites() {
    wx.showToast({ title: '收藏功能开发中', icon: 'none' })
  },

  viewHistory() {
    wx.showToast({ title: '历史功能开发中', icon: 'none' })
  },

  viewSettings() {
    wx.showToast({ title: '设置功能开发中', icon: 'none' })
  },

  viewAbout() {
    wx.showToast({ title: '法律智能体 v1.0.0', icon: 'none' })
  },

  async onLogout() {
    wx.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.logout()
          } catch (error) {
            console.error('登出请求失败:', error)
          }
          app.logout()
          wx.showToast({ title: '已退出登录', icon: 'success' })
          setTimeout(() => {
            wx.redirectTo({ url: '/pages/login/login' })
          }, 1000)
        }
      }
    })
  },
})
