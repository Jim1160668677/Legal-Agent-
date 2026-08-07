import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import Layout from './components/Layout'
import Login from './pages/Login'
import Chat from './pages/Chat'
import CaseAnalysis from './pages/CaseAnalysis'
import Knowledge from './pages/Knowledge'
import Profile from './pages/Profile'
import PrivacyPolicy from './pages/PrivacyPolicy'
import UserAgreement from './pages/UserAgreement'
import AiDisclaimer from './pages/AiDisclaimer'
import { useAuthStore } from './stores/authStore'

function App() {
  const { isAuthenticated } = useAuthStore()

  return (
    <ConfigProvider locale={zhCN}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to="/" />} />
          <Route
            path="/"
            element={isAuthenticated ? <Layout /> : <Navigate to="/login" />}
          >
            <Route index element={<Chat />} />
            <Route path="chat/:sessionId" element={<Chat />} />
            <Route path="analysis" element={<CaseAnalysis />} />
            <Route path="knowledge" element={<Knowledge />} />
            <Route path="profile" element={<Profile />} />
          </Route>
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/agreement" element={<UserAgreement />} />
          <Route path="/disclaimer" element={<AiDisclaimer />} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  )
}

export default App
