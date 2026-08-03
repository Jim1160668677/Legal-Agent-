/**
 * 聊天页面 - 完整版本
 */
import { useEffect, useRef, useState } from 'react'
import { Input, Button, Spin, Empty, Avatar, Typography, Tag, Space, Drawer } from 'antd'
import { SendOutlined, RobotOutlined, UserOutlined, PlusOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import { useChatStore } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import { LegalAgentClient, type ChatMessage, type ChatSession } from '@legal-agent/sdk'
import ChatList from './ChatList'
import LawCitation from './LawCitation'
import { ChatSkeleton } from './Skeleton'

const { Text } = Typography

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
const client = new LegalAgentClient({ baseUrl: API_BASE_URL })

export default function Chat() {
  const { 
    currentSessionId, 
    messages, 
    isLoading, 
    isTyping,
    addMessage,
    setLoading,
    setTyping,
    setCurrentSession
  } = useChatStore()
  const [inputValue, setInputValue] = useState('')
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [sessionTitle, setSessionTitle] = useState('新对话')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  useEffect(() => {
    if (currentSessionId) {
      loadMessages()
    }
  }, [currentSessionId])

  const loadMessages = async () => {
    if (!currentSessionId) return
    setLoading(true)
    try {
      const response = await client.getMessages(currentSessionId)
      // TODO: 更新store
    } finally {
      setLoading(false)
    }
  }

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return

    const content = inputValue.trim()
    setInputValue('')
    setTyping(true)

    // 用户消息
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      sessionId: currentSessionId || '',
      role: 'user',
      content,
      type: 'text',
      createdAt: new Date().toISOString(),
    }
    addMessage(userMessage)

    try {
      // 如果是新会话，先创建
      let sessionId = currentSessionId
      if (!sessionId) {
        const session = await client.createSession()
        sessionId = session.id
        setCurrentSession(sessionId)
        setSessionTitle(session.title || '新对话')
      }

      // 发送消息（这里简化处理，实际需要流式响应）
      const response = await client.sendMessage(sessionId, content)
      addMessage(response)
    } catch (error) {
      console.error('发送消息失败:', error)
    } finally {
      setTyping(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleNewChat = () => {
    setDrawerVisible(true)
  }

  return (
    <div style={{ height: 'calc(100vh - 148px)', display: 'flex', gap: 16 }}>
      {/* 侧边栏 - 会话列表 */}
      <Drawer
        title="对话历史"
        placement="left"
        width={320}
        open={drawerVisible}
        onClose={() => setDrawerVisible(false)}
      >
        <ChatList onSelect={(id) => {
          setCurrentSession(id)
          setDrawerVisible(false)
        }} />
      </Drawer>

      {/* 主聊天区域 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid #f0f0f0',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {/* 头部 */}
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Avatar icon={<RobotOutlined />} style={{ background: '#1890ff' }} />
          <div style={{ flex: 1 }}>
            <Text strong>{sessionTitle}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}> AI法律助手</Text>
          </div>
          <Button icon={<PlusOutlined />} onClick={handleNewChat}>
            新建对话
          </Button>
        </div>

        {/* 消息列表 */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
            background: '#fafafa',
          }}
        >
          {isLoading && messages.length === 0 ? (
            <ChatSkeleton />
          ) : messages.length === 0 ? (
            <Empty
              description="开始与法律智能体对话，我将为您提供专业的法律咨询"
              style={{ marginTop: 100 }}
            >
              <Space direction="vertical">
                <Tag color="blue">合同纠纷咨询</Tag>
                <Tag color="green">劳动争议帮助</Tag>
                <Tag color="orange">房产法律咨询</Tag>
              </Space>
            </Empty>
          ) : (
            messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))
          )}

          {isTyping && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <Avatar icon={<RobotOutlined />} style={{ background: '#1890ff' }} />
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: '16px 16px 16px 4px',
                  background: '#fff',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                }}
              >
                <Spin size="small" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 输入框 */}
        <div
          style={{
            padding: '16px',
            borderTop: '1px solid #f0f0f0',
            background: '#fff',
          }}
        >
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="请输入您的法律问题，按 Enter 发送..."
            onPressEnter={handleSend}
            disabled={isLoading}
            size="large"
            prefix={<Text type="secondary">提问</Text>}
          />
        </div>
      </div>
    </div>
  )
}

// 消息气泡组件
function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        marginBottom: 16,
        justifyContent: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      {!isUser && (
        <Avatar icon={<RobotOutlined />} style={{ background: '#1890ff' }} />
      )}
      <div
        style={{
          maxWidth: '75%',
          padding: '12px 16px',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          background: isUser ? '#1890ff' : '#fff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
        }}
      >
        {isUser ? (
          <Text style={{ color: '#fff' }}>{message.content}</Text>
        ) : (
          <div>
            <ReactMarkdown
              rehypePlugins={[rehypeHighlight, rehypeRaw]}
              components={{
                p: ({ children }) => <p style={{ marginBottom: 8 }}>{children}</p>,
                ul: ({ children }) => <ul style={{ marginLeft: 20 }}>{children}</ul>,
                ol: ({ children }) => <ol style={{ marginLeft: 20 }}>{children}</ol>,
              }}
            >
              {message.content}
            </ReactMarkdown>
            {message.metadata?.lawRefs && (
              <div style={{ marginTop: 8 }}>
                {message.metadata.lawRefs.map((ref: string, idx: number) => (
                  <LawCitation
                    key={idx}
                    law={ref.split('第')[0]}
                    article={ref}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4, opacity: 0.7 }}>
          {new Date(message.createdAt).toLocaleTimeString()}
        </Text>
      </div>
      {isUser && (
        <Avatar icon={<UserOutlined />} style={{ background: '#52c41a' }} />
      )}
    </div>
  )
}
