/**
 * 布局组件
 */
import { useState } from 'react'
import { Layout, Menu, Avatar, Dropdown, Space } from 'antd'
import {
  MessageOutlined,
  FileTextOutlined,
  SearchOutlined,
  UserOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

const { Header, Sider, Content } = Layout

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const [collapsed, setCollapsed] = useState(false)

  const menuItems = [
    { key: '/', icon: <MessageOutlined />, label: '对话' },
    { key: '/analysis', icon: <FileTextOutlined />, label: '案件分析' },
    { key: '/knowledge', icon: <SearchOutlined />, label: '法律知识' },
    { key: '/profile', icon: <UserOutlined />, label: '个人中心' },
  ]

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人中心',
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
    },
  ]

  const handleMenuClick = ({ key }: { key: string }) => {
    if (key === 'logout') {
      logout()
      navigate('/login')
    } else {
      navigate(key)
    }
  }

  const handleUserMenuClick = ({ key }: { key: string }) => {
    if (key === 'logout') {
      logout()
      navigate('/login')
    } else {
      navigate('/profile')
    }
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        style={{
          boxShadow: '2px 0 8px rgba(0,0,0,0.1)',
        }}
      >
        <div style={{ padding: '16px', textAlign: 'center', color: '#fff' }}>
          <h2 style={{ fontSize: collapsed ? 14 : 18, margin: 0 }}>
            {collapsed ? '法' : '法律智能体'}
          </h2>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems.map((item) => ({
            ...item,
            icon: collapsed ? null : item.icon,
          }))}
          onClick={handleMenuClick}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            padding: '0 24px',
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
          }}
        >
          <div>
            {collapsed ? (
              <MenuUnfoldOutlined
                onClick={() => setCollapsed(false)}
                style={{ fontSize: 18, cursor: 'pointer' }}
              />
            ) : (
              <MenuFoldOutlined
                onClick={() => setCollapsed(true)}
                style={{ fontSize: 18, cursor: 'pointer' }}
              />
            )}
          </div>
          <Dropdown
            menu={{ items: userMenuItems, onClick: handleUserMenuClick }}
            placement="bottomRight"
          >
            <Space style={{ cursor: 'pointer' }}>
              <Avatar icon={<UserOutlined />} />
              <span>{user?.username || '用户'}</span>
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ margin: 24, overflow: 'initial' }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  )
}
