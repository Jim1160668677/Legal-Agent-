/**
 * 加载骨架屏组件
 */
import { useEffect, useState } from 'react'

interface LoadingSkeletonProps {
  type?: 'message' | 'card' | 'list' | 'text'
  count?: number
  loading?: boolean
  height?: number
}

export default function LoadingSkeleton({
  type = 'message',
  count = 1,
  loading = true,
  height = 48,
}: LoadingSkeletonProps) {
  const [visible, setVisible] = useState(loading)

  useEffect(() => {
    if (loading) setVisible(true)
  }, [loading])

  if (!visible) return null

  const items = Array.from({ length: count }, (_, i) => i)

  if (type === 'message') {
    return (
      <div className="skeleton-container">
        {items.map((i) => (
          <div key={i} className={`skeleton-message skeleton-message-${i % 2 === 0 ? 'left' : 'right'}`}>
            {i % 2 === 0 && <div className="skeleton-avatar" />}
            <div className="skeleton-content">
              <div className="skeleton-line" style={{ height: `${height}px`, width: `${60 + Math.random() * 30}%` }} />
              {i % 3 === 0 && <div className="skeleton-line" style={{ height: '20px', width: '40%' }} />}
            </div>
            {i % 2 !== 0 && <div className="skeleton-avatar" />}
          </div>
        ))}
      </div>
    )
  }

  if (type === 'card') {
    return (
      <div className="skeleton-card">
        <div className="skeleton-line" style={{ height: '120px', width: '100%', marginBottom: '16px' }} />
        <div className="skeleton-line" style={{ height: '20px', width: '70%' }} />
        <div className="skeleton-line" style={{ height: '16px', width: '50%', marginTop: '8px' }} />
      </div>
    )
  }

  if (type === 'list') {
    return (
      <div className="skeleton-list">
        {items.map((i) => (
          <div key={i} className="skeleton-list-item">
            <div className="skeleton-line" style={{ height: '16px', width: '30%' }} />
            <div className="skeleton-line" style={{ height: '16px', width: '60%' }} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="skeleton-text">
      {items.map((i) => (
        <div
          key={i}
          className="skeleton-line"
          style={{ height: '16px', width: `${50 + Math.random() * 40}%`, marginBottom: '12px' }}
        />
      ))}
    </div>
  )
}
