/**
 * 首页重定向到聊天页面
 */
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Index() {
  const navigate = useNavigate()

  useEffect(() => {
    navigate('/chat', { replace: true })
  }, [navigate])

  return null
}
