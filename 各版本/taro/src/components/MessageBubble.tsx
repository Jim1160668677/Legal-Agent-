/**
 * 消息气泡组件
 */
import type { ChatMessage } from '@legal-agent/sdk'

interface MessageBubbleProps {
  message: ChatMessage
  isLast?: boolean
}

export default function MessageBubble({ message, isLast = false }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div className={`message-bubble ${isUser ? 'message-user' : 'message-assistant'} ${isLast ? 'message-last' : ''}`}>
      {!isUser && (
        <div className="message-avatar">
          <span className="avatar-icon">⚖️</span>
        </div>
      )}
      <div className={`message-content ${isUser ? 'message-content-user' : 'message-content-assistant'}`}>
        <p className="message-text">{message.content || ' '}</p>
        <span className="message-time">
          {new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {isUser && (
        <div className="message-avatar">
          <div className="avatar-user">👤</div>
        </div>
      )}
    </div>
  )
}
