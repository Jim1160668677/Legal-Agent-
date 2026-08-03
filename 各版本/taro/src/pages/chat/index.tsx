/**
 * 聊天页面
 */
import { useEffect, useState, useRef } from 'react'
import { useChatStore } from '../../stores/chat'
import { useAuthStore } from '../../stores/auth'
import MessageBubble from '../../components/MessageBubble'
import LoadingSkeleton from '../../components/LoadingSkeleton'

export default function Chat() {
  const {
    sessions,
    currentSessionId,
    messages,
    isLoading,
    isTyping,
    isStreaming,
    setCurrentSession,
    loadSessions,
    createSession,
    sendMessage,
    deleteSession,
  } = useChatStore()
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const [inputText, setInputText] = useState('')
  const [showSessionList, setShowSessionList] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      window.location.href = '/login'
      return
    }
    loadSessions()
  }, [isAuthenticated])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  const handleSendMessage = async () => {
    if (!inputText.trim() || !currentSessionId || isStreaming) return
    const content = inputText.trim()
    setInputText('')
    try {
      await sendMessage(currentSessionId, content)
    } catch (err: any) {
      alert(err.message || '发送失败')
    }
  }

  const handleCreateSession = async () => {
    try {
      await createSession()
      setShowSessionList(false)
    } catch (err: any) {
      alert(err.message || '创建失败')
    }
  }

  const handleSelectSession = (sessionId: string) => {
    setCurrentSession(sessionId)
    setShowSessionList(false)
  }

  const handleDeleteSession = async (sessionId: string) => {
    if (!confirm('确定要删除这个对话吗？')) return
    await deleteSession(sessionId)
    if (currentSessionId === sessionId) {
      setCurrentSession('')
    }
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="page chat-page">
      <div className="chat-header">
        <button className="header-btn" onClick={() => setShowSessionList(!showSessionList)}>
          <span className="header-btn-text">
            {sessions.length > 0 ? '历史对话' : '+ 新对话'}
          </span>
        </button>
        <span className="header-title">法律智能体</span>
        <button className="header-btn" onClick={handleCreateSession}>
          <span className="header-btn-text">新建</span>
        </button>
      </div>

      {showSessionList && (
        <div className="session-list-overlay" onClick={() => setShowSessionList(false)}>
          <div className="session-list" onClick={(e) => e.stopPropagation()}>
            <div className="session-list-header">
              <span className="session-list-title">选择对话</span>
              <button className="close-btn" onClick={() => setShowSessionList(false)}>×</button>
            </div>
            <div className="session-list-content">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className={`session-item ${currentSessionId === session.id ? 'session-item-active' : ''}`}
                  onClick={() => handleSelectSession(session.id)}
                >
                  <div className="session-item-info">
                    <span className="session-item-title">{session.title || session.intent || '新对话'}</span>
                    <span className="session-item-time">
                      {new Date(session.updatedAt).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                  <button className="session-item-delete" onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id) }}>
                    删除
                  </button>
                </div>
              ))}
              {sessions.length === 0 && (
                <div className="session-empty">
                  <span>暂无对话记录</span>
                </div>
              )}
            </div>
            <button className="session-create-btn" onClick={handleCreateSession}>
              新建对话
            </button>
          </div>
        </div>
      )}

      <div className="chat-messages">
        {isLoading && messages.length === 0 ? (
          <LoadingSkeleton type="message" count={3} />
        ) : messages.length === 0 ? (
          <div className="chat-empty">
            <span className="empty-icon">⚖️</span>
            <span className="empty-text">开始对话，获取法律智能分析</span>
            <button className="empty-btn" onClick={handleCreateSession}>
              新建对话
            </button>
          </div>
        ) : (
          messages.map((msg, index) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isLast={index === messages.length - 1}
            />
          ))
        )}
        {isTyping && (
          <div className="typing-indicator">
            <div className="typing-dots">
              <div className="typing-dot" />
              <div className="typing-dot" />
              <div className="typing-dot" />
            </div>
            <span className="typing-text">助手正在思考...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <input
          className="chat-input"
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="输入法律问题..."
          disabled={isStreaming}
          onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
        />
        <button
          className="send-btn"
          disabled={!inputText.trim() || isStreaming}
          onClick={handleSendMessage}
        >
          {isStreaming ? '...' : '发送'}
        </button>
      </div>
    </div>
  )
}
