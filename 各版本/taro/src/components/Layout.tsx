// Layout 组件
import { useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Layout as AntLayout, Menu } from 'antd'
import {
  MessageOutlined,
  FileTextOutlined,
  BookOutlined,
  UserOutlined,
} from '@ant-design/icons'

const { Sider, Content } = AntLayout

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)

  const menuItems = [
    { key: '/chat', icon: <MessageOutlined />, label: '对话' },
    { key: '/analysis', icon: <FileTextOutlined />, label: '分析' },
    { key: '/knowledge', icon: <BookOutlined />, label: '知识' },
    { key: '/profile', icon: <UserOutlined />, label: '我的' },
  ]

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="dark"
        style={{ position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 100 }}
      >
        <div style={{ height: 32, margin: 16, color: '#fff', textAlign: 'center', fontSize: collapsed ? 12 : 16 }}>
          {collapsed ? '法' : '法律智能体'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <AntLayout
        style={{ marginLeft: collapsed ? 80 : 200, marginTop: 64 }}
      >
        <Content style={{ padding: 24, minHeight: 280 }}>
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  )
}
