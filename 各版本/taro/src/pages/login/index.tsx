/**
 * 登录页面
 */
import { useState, useEffect } from 'react'
import { useAuthStore } from '../../stores/auth'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [redirect, setRedirect] = useState(false)

  const login = useAuthStore((state) => state.login)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)

  useEffect(() => {
    if (isAuthenticated) {
      setRedirect(true)
      window.location.href = '/chat'
    }
  }, [isAuthenticated])

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError('请输入用户名和密码')
      return
    }
    setLoading(true)
    setError('')
    try {
      await login(username.trim(), password)
      setRedirect(true)
      window.location.href = '/chat'
    } catch (err: any) {
      setError(err.message || '登录失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  if (redirect) return null

  return (
    <div className="page login-page">
      <div className="login-header">
        <div className="login-logo">⚖️</div>
        <h1 className="login-title">法律智能体</h1>
        <p className="login-subtitle">您的AI法律助手</p>
      </div>

      <div className="login-form">
        <div className="form-item">
          <input
            className="form-input"
            type="text"
            placeholder="请输入用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </div>
        <div className="form-item">
          <input
            className="form-input"
            type={showPassword ? 'text' : 'password'}
            placeholder="请输入密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="show-password" onClick={() => setShowPassword(!showPassword)}>
            {showPassword ? '隐藏' : '显示'}
          </button>
        </div>

        {error && <div className="form-error"><span>{error}</span></div>}

        <button className="login-btn" disabled={loading} onClick={handleLogin}>
          {loading ? '登录中...' : '登录'}
        </button>

        <div className="login-divider">
          <span>或使用以下方式登录</span>
        </div>

        <button className="wechat-login-btn" onClick={() => alert('微信登录功能开发中')}>
          微信一键登录
        </button>
      </div>

      <div className="login-footer">
        <span className="footer-text">登录后即表示同意</span>
        <a className="footer-link" href="#">用户协议</a>
        <span className="footer-text">和</span>
        <a className="footer-link" href="#">隐私政策</a>
      </div>
    </div>
  )
}
