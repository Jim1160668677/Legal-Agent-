/**
 * 微信小程序 - 聊天页面
 */
const app = getApp()
const { api } = require('../../utils/api')

Page({
  data: {
    sessions: [],
    currentSession: null,
    messages: [],
    inputValue: '',
    loading: false,
    scrollToId: '',
    hasMore: true,
    page: 1,
  },

  onLoad() {
    this.loadSessions()
  },

  onShow() {
    // 每次显示时刷新会话列表
    if (!this.data.currentSession) {
      this.loadSessions()
    }
  },

  async loadSessions() {
    this.setData({ loading: true, page: 1 })
    try {
      const res = await api.getSessionList(1, 20)
      const sessions = res.data?.items || []
      this.setData({
        sessions,
        loading: false,
        hasMore: sessions.length >= 20
      })
    } catch (error) {
      console.error('加载会话失败:', error)
      wx.showToast({ title: '加载失败', icon: 'error' })
      this.setData({ loading: false })
    }
  },

  selectSession(e: any) {
    const sessionId = e.currentTarget.dataset.id
    this.loadMessages(sessionId)
  },

  async loadMessages(sessionId: string, page = 1) {
    this.setData({ loading: true })
    try {
      const res = await api.getSessionMessages(sessionId, page, 20)
      const messages = res.data?.items || []
      const currentSession = messages.length > 0
        ? (this.data.sessions.find(s => s.id === sessionId) || { id: sessionId, intent: '法律咨询' })
        : { id: sessionId, intent: '法律咨询' }

      if (page === 1) {
        this.setData({ messages, currentSession, hasMore: messages.length >= 20 })
      } else {
        this.setData({
          messages: [...messages, ...this.data.messages],
          hasMore: messages.length >= 20
        })
      }
    } catch (error) {
      console.error('加载消息失败:', error)
      wx.showToast({ title: '加载失败', icon: 'error' })
    } finally {
      this.setData({ loading: false })
    }
  },

  backToList() {
    this.setData({ currentSession: null, messages: [] })
    this.loadSessions()
  },

  createNewChat() {
    this.setData({ currentSession: null, messages: [] })
  },

  onInputChange(e: any) {
    this.setData({ inputValue: e.detail.value })
  },

  onInputBlur() {
    // 触发表单更新
    this.setData({})
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath
        this.uploadImage(tempFilePath)
      },
    })
  },

  async uploadImage(filePath: string) {
    wx.showLoading({ title: '上传中...' })
    try {
      const res = await api.uploadFile(filePath)
      // 发送图片消息
      await this.sendMessageWithContent(res.url, 'image')
    } catch (error) {
      console.error('上传图片失败:', error)
      wx.showToast({ title: '上传失败', icon: 'error' })
    } finally {
      wx.hideLoading()
    }
  },

  async sendMessage(e: any) {
    const content = this.data.inputValue.trim()
    if (!content || this.data.loading) return

    this.setData({ loading: true, inputValue: '' })

    try {
      // 创建或获取会话
      let sessionId = this.data.currentSession?.id
      let session = this.data.currentSession

      if (!sessionId) {
        const sessionRes = await api.createSession(content)
        sessionId = sessionRes.data?.id
        session = sessionRes.data
        this.setData({ currentSession: session })
      }

      // 添加用户消息到显示列表
      const userMessage = {
        id: Date.now(),
        content,
        messageType: 'user',
        createdAt: this.formatTime(new Date()),
      }
      this.setData({
        messages: [...this.data.messages, userMessage],
        loading: false,
      })

      // 添加AI思考中消息
      const aiMsgId = Date.now() + 1
      this.setData({
        messages: [...this.data.messages, userMessage, {
          id: aiMsgId,
          content: '',
          messageType: 'ai',
          createdAt: this.formatTime(new Date()),
          thinking: true,
        }]
      })

      // 发送消息并处理流式响应
      await this.sendStreamMessage(sessionId, content, aiMsgId)

      // 刷新会话列表
      this.loadSessions()
    } catch (error: any) {
      console.error('发送消息失败:', error)
      wx.showToast({ title: error.message || '发送失败', icon: 'error' })
      this.setData({ loading: false })
    }
  },

  async sendStreamMessage(sessionId: string, content: string, aiMsgId: number) {
    const token = wx.getStorageSync('token')

    // 创建 WebSocket 连接进行流式响应
    const socket = wx.connectSocket({
      url: `wss://${new URL(app.globalData.apiBaseUrl).host}/v1/chat/sessions/${sessionId}/stream`,
      header: {
        Authorization: `Bearer ${token}`,
      },
    })

    let fullContent = ''

    socket.onOpen(() => {
      console.log('WebSocket 连接已建立')
    })

    socket.onMessage((res) => {
      try {
        const data = JSON.parse(res.data)
        if (data.content) {
          fullContent += data.content
          this.setData({
            [`messages[${this.data.messages.length - 1}].content`]: fullContent,
          })
        }
        if (data.done) {
          socket.close()
        }
      } catch {
        // 如果不是 JSON，直接追加
        fullContent += res.data
        this.setData({
          [`messages[${this.data.messages.length - 1}].content`]: fullContent,
        })
      }
    })

    socket.onError((err) => {
      console.error('WebSocket 错误:', err)
      // 降级到普通 HTTP 请求
      this.fallbackSendMessage(sessionId, content, aiMsgId)
    })

    socket.onClose(() => {
      console.log('WebSocket 连接已关闭')
    })

    // 设置超时
    setTimeout(() => {
      if (socket.readyState !== 4) {
        socket.close()
        this.fallbackSendMessage(sessionId, content, aiMsgId)
      }
    }, 30000)
  },

  async fallbackSendMessage(sessionId: string, content: string, aiMsgId: number) {
    try {
      const res = await api.sendMessage(sessionId, content, 'text')
      const aiMessage = res.data
      this.setData({
        [`messages[${this.data.messages.length - 1}].content`]: aiMessage?.content || '',
        [`messages[${this.data.messages.length - 1}].thinking`]: false,
      })
    } catch (error) {
      console.error('发送消息失败:', error)
      wx.showToast({ title: '发送失败', icon: 'error' })
      this.setData({ loading: false })
    }
  },

  async deleteSession(e: any) {
    const sessionId = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认删除',
      content: '确定要删除该对话吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.deleteSession(sessionId)
            if (this.data.currentSession?.id === sessionId) {
              this.setData({ currentSession: null, messages: [] })
            }
            this.loadSessions()
            wx.showToast({ title: '已删除', icon: 'success' })
          } catch (error) {
            wx.showToast({ title: '删除失败', icon: 'error' })
          }
        }
      }
    })
  },

  loadMoreMessages() {
    // 加载更多消息
  },

  formatTime(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    return `${hours}:${minutes}`
  },
})
