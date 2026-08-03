/**
 * 个人中心页面
 */
import { useState, useEffect } from 'react'
import { useAuthStore } from '../../stores/auth'

export default function Profile() {
  const { user, isAuthenticated, logout } = useAuthStore()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (user) {
      setName(user.profile?.name || user.username || '')
      setPhone(user.profile?.phone || '')
      setEmail(user.profile?.email || '')
    }
  }, [user])

  useEffect(() => {
    if (!isAuthenticated) {
      window.location.href = '/login'
    }
  }, [isAuthenticated])

  const handleSave = async () => {
    setSaving(true)
    try {
      const { getApiService } = await import('../../services/api')
      const apiService = getApiService()
      const updatedUser = await apiService.updateUserProfile({
        profile: { name, phone, email },
      } as any)
      useAuthStore.getState().updateUser(updatedUser)
      setEditing(false)
      alert('保存成功')
    } catch (err: any) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = async () => {
    if (!confirm('确定要退出登录吗？')) return
    await logout()
    window.location.href = '/login'
  }

  if (!isAuthenticated) {
    return null
  }

  const menuItems = [
    { icon: '📋', title: '我的案件', desc: '查看历史案件记录' },
    { icon: '📚', title: '我的收藏', desc: '收藏的法律知识' },
    { icon: '📄', title: '我的文档', desc: '生成的法律文书' },
    { icon: '⚙️', title: '设置', desc: '应用设置' },
    { icon: '❓', title: '帮助中心', desc: '使用指南与FAQ' },
  ]

  return (
    <div className="page profile-page">
      <div className="profile-header">
        <img
          className="avatar"
          src={user?.profile?.avatar || 'https://via.placeholder.com/80'}
          alt="avatar"
        />
        <div className="user-info">
          <span className="username">{user?.profile?.name || user?.username || '未设置昵称'}</span>
          <span className="user-role">{user?.role === 'lawyer' ? '律师' : user?.role === 'admin' ? '管理员' : '用户'}</span>
        </div>
        <button className="edit-btn" onClick={() => setEditing(!editing)}>
          {editing ? '取消' : '编辑'}
        </button>
      </div>

      {editing && (
        <div className="edit-form">
          <div className="form-item">
            <label className="form-label">姓名</label>
            <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="请输入姓名" />
          </div>
          <div className="form-item">
            <label className="form-label">手机号</label>
            <input className="form-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="请输入手机号" />
          </div>
          <div className="form-item">
            <label className="form-label">邮箱</label>
            <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="请输入邮箱" />
          </div>
          <button className="save-btn" disabled={saving} onClick={handleSave}>
            保存修改
          </button>
        </div>
      )}

      <div className="profile-menu">
        {menuItems.map((item, i) => (
          <div key={i} className="menu-item" onClick={() => alert('功能开发中')}>
            <div className="menu-left">
              <span className="menu-icon">{item.icon}</span>
              <span className="menu-title">{item.title}</span>
            </div>
            <span className="menu-desc">{item.desc}</span>
            <span className="menu-arrow">›</span>
          </div>
        ))}
      </div>

      <div className="profile-footer">
        <button className="logout-btn" onClick={handleLogout}>
          退出登录
        </button>
        <span className="app-version">法律智能体 v1.0.0</span>
      </div>
    </div>
  )
}
