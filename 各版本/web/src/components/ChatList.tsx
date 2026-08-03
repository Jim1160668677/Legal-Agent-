/**
 * 聊天列表组件
 */
import { useState, useEffect } from 'react'
import { List, Avatar, Button, Empty, Spin, Tag } from 'antd'
import { MessageOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useChatStore } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import { LegalAgentClient, type ChatSession } from '@legal-agent/sdk'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
const client = new LegalAgentClient({ baseUrl: API_BASE_URL })

export default function ChatList({ onSelect }: { onSelect: (sessionId: string) => void }) {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [loading, setLoading] = useState(false)
  const { currentSessionId, setCurrentSession } = useChatStore()
  const { isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated) return
    loadSessions()
  }, [isAuthenticated])

  const loadSessions = async () => {
    setLoading(true)
    try {
      const response = await client.listSessions(1, 50)
      setSessions(response.data.items || [])
    } catch (error) {
      console.error('加载会话失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleNewChat = async () => {
    try {
      const session = await client.createSession()
      setCurrentSession(session.id)
      onSelect(session.id)
    } catch (error) {
      console.error('创建会话失败:', error)
    }
  }

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    try {
      await client.deleteSession(sessionId)
      loadSessions()
      if (currentSessionId === sessionId) {
        setCurrentSession('')
      }
    } catch (error) {
      console.error('删除会话失败:', error)
    }
  }

  if (!isAuthenticated) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <Empty description="请先登录" />
      </div>
    )
  }

  return (
    <>
      <div style={{ padding: '16px', borderBottom: '1px solid #f0f0f0' }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          block
          onClick={handleNewChat}
        >
          新对话
        </Button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : sessions.length === 0 ? (
        <Empty description="暂无对话记录" style={{ marginTop: 40 }} />
      ) : (
        <List
          dataSource={sessions}
          renderItem={(item) => (
            <List.Item
              style={{
                cursor: 'pointer',
                background: item.id === currentSessionId ? '#e6f7ff' : 'transparent',
                borderRadius: 8,
                margin: '4px 8px',
                padding: '12px 16px',
              }}
              onClick={() => {
                setCurrentSession(item.id)
                onSelect(item.id)
              }}
              extra={
                <DeleteOutlined
                  style={{ color: '#ff4d4f' }}
                  onClick={(e) => handleDelete(e, item.id)}
                />
              }
            >
              <List.Item.Meta
                avatar={<Avatar icon={<MessageOutlined />} style={{ background: '#1890ff' }} />}
                title={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{item.title || '新对话'}</span>
                    {item.intent && (
                      <Tag color="blue" style={{ fontSize: 10 }}>
                        {item.intent}
                      </Tag>
                    )}
                  </div>
                }
                description={
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#999' }}>
                    <span>{dayjs(item.updatedAt).format('MM-DD HH:mm')}</span>
                  </div>
                }
              />
            </List.Item>
          )}
        />
      )}
    </>
  )
}
