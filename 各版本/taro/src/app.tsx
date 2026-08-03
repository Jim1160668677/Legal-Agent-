// Taro H5 App 入口
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import Layout from './components/Layout'
import Login from './pages/login'
import Chat from './pages/chat'
import Analysis from './pages/analysis'
import Knowledge from './pages/knowledge'
import Profile from './pages/profile'
import './styles/common.scss'

export default function App() {
  return (
    <ConfigProvider locale={zhCN}>
      <Router>
        <Layout>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Navigate to="/chat" replace />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/chat/:sessionId" element={<Chat />} />
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/knowledge" element={<Knowledge />} />
            <Route path="/profile" element={<Profile />} />
          </Routes>
        </Layout>
      </Router>
    </ConfigProvider>
  )
}
