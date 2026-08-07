/**
 * 登录页面
 */
import { useState, useEffect } from 'react'
import { Form, Input, Button, Card, Alert, Typography, Spin } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { LegalAgentClient } from '@legal-agent/sdk'

const { Title, Text } = Typography

// 从环境变量获取API地址，本地模式使用 localhost
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

// 本地模式：自动检测
const isLocal = API_BASE_URL.includes('localhost') || API_BASE_URL.includes('127.0.0.1')

export default function Login() {
  const navigate = useNavigate()
  const { login } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [autoLogin, setAutoLogin] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const client = new LegalAgentClient({
    baseUrl: API_BASE_URL,
  })

  // 本地模式：自动登录
  useEffect(() => {
    if (isLocal) {
      setAutoLogin(true)
      const timer = setTimeout(() => {
        login({ id: 'local-user', username: '本地用户' }, 'local-token', 'local-refresh')
        navigate('/')
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [])

  const handleSubmit = async (values: { username: string; password: string }) => {
    setLoading(true)
    setError(null)

    try {
      // 本地模式：自动创建本地用户
      if (isLocal) {
        login({ id: 'local-user', username: '本地用户' }, 'local-token', 'local-refresh')
        navigate('/')
        return
      }

      // 正常登录逻辑
      const result = await client.login(values.username, values.password)
      login(result.user, result.token, result.refreshToken)
      navigate('/')
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '登录失败，请检查用户名和密码')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}
    >
      <Card
        style={{
          width: 400,
          boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={2} style={{ color: '#1890ff', marginBottom: 8 }}>
            法律智能体
          </Title>
          <Text type="secondary">您的AI法律助手</Text>
        </div>

        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        {autoLogin && (
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <Spin size="small" />
            <Text type="secondary" style={{ marginLeft: 8 }}>正在自动登录...</Text>
          </div>
        )}

        <Form
          onFinish={handleSubmit}
          size="large"
          layout="vertical"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input
              prefix={<UserOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="用户名"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
              placeholder="密码"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 16 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              style={{ height: 44 }}
            >
              登录
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            演示账号: admin / admin123
          </Text>
        </div>
      </Card>
    </div>
  )
}
