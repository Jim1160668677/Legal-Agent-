/**
 * 骨架屏加载组件
 */
import { Skeleton, Card, List } from 'antd'

export function ChatSkeleton() {
  return (
    <div style={{ padding: 16 }}>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: 12,
            marginBottom: 16,
            justifyContent: i % 2 === 0 ? 'flex-end' : 'flex-start',
          }}
        >
          <Skeleton.Avatar active size={40} />
          <Skeleton
            active
            paragraph={{ rows: 2, width: i % 2 === 0 ? '60%' : '80%' }}
            style={{ alignSelf: i % 2 === 0 ? 'flex-end' : 'flex-start' }}
          />
        </div>
      ))}
    </div>
  )
}

export function AnalysisSkeleton() {
  return (
    <Card loading style={{ maxWidth: 800 }}>
      <Skeleton active paragraph={{ rows: 4 }} />
      <Skeleton active />
      <Skeleton active />
    </Card>
  )
}

export function ListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <List
      loading
      dataSource={Array.from({ length: count })}
      renderItem={() => (
        <List.Item>
          <Skeleton active avatar />
        </List.Item>
      )}
    />
  )
}
