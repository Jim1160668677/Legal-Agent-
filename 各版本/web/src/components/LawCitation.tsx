/**
 * 法律条文高亮组件
 */
import { Tag, Popover, Tooltip } from 'antd'
import { BookOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'

interface LawCitationProps {
  law: string
  article: string
  content?: string
}

export default function LawCitation({ law, article, content }: LawCitationProps) {
  const citation = `${law}${article}`

  const contentNode = content ? (
    <div style={{ maxHeight: 300, overflowY: 'auto' }}>
      <ReactMarkdown children={content} />
    </div>
  ) : null

  return (
    <Popover
      content={contentNode}
      title={
        <span style={{ fontWeight: 'bold' }}>{citation}</span>
      }
      trigger="hover"
      placement="topLeft"
    >
      <Tooltip title={`点击查看 ${law} 全文`}>
        <Tag
          color="blue"
          icon={<BookOutlined />}
          style={{
            cursor: 'pointer',
            marginRight: 4,
            marginBottom: 4,
          }}
        >
          {citation}
        </Tag>
      </Tooltip>
    </Popover>
  )
}

/**
 * 渲染法条引用的工具函数
 */
export function renderLawRefs(content: string): JSX.Element[] {
  const regex = /《([^》]+)》(.+?)(?:条|款|项)/g
  const matches = [...content.matchAll(regex)]
  
  return matches.map((match, index) => {
    const law = match[1]
    const article = match[2] + '条'
    return <LawCitation key={index} law={law} article={article} />
  })
}

/**
 * Markdown 内容渲染器 - 支持法条引用高亮
 */
export function LegalMarkdown({ content }: { content: string }) {
  return (
    <div className="legal-content">
      <ReactMarkdown
        children={content}
        components={{
          p: ({ children }) => <p style={{ marginBottom: 8 }}>{children}</p>,
          ul: ({ children }) => <ul style={{ marginLeft: 20, marginBottom: 8 }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ marginLeft: 20, marginBottom: 8 }}>{children}</ol>,
          strong: ({ children }) => <strong style={{ color: '#1890ff' }}>{children}</strong>,
        }}
      />
    </div>
  )
}
