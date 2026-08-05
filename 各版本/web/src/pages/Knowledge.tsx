/**
 * 法律知识页面 - 完整版本
 */
import { useState, useEffect } from 'react'
import {
  Input,
  Card,
  List,
  Typography,
  Tag,
  Spin,
  Empty,
  Button,
  Space,
  Select,
} from 'antd'
import {
  SearchOutlined,
  BookOutlined,
  ThunderboltOutlined,
  FireOutlined,
} from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import { LegalAgentClient, type KnowledgeResult } from '@legal-agent/sdk'
import LawCitation from '../components/LawCitation'

const { Title, Text } = Typography

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''
const client = new LegalAgentClient({ baseUrl: API_BASE_URL })

// 热门搜索词
const HOT_SEARCHES = [
  '合同纠纷',
  '劳动争议',
  '房产继承',
  '交通事故',
  '借款合同',
  '离婚财产',
  '工伤赔偿',
]

export default function Knowledge() {
  const [searchQuery, setSearchQuery] = useState('')
  const [results, setResults] = useState<KnowledgeResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [category, setCategory] = useState<string>('all')
  const [recentSearches, setRecentSearches] = useState<string[]>([])

  // 加载最近搜索历史
  useEffect(() => {
    const saved = localStorage.getItem('recent_searches')
    if (saved) {
      try {
        setRecentSearches(JSON.parse(saved))
      } catch (e) {
        console.error('解析搜索历史失败:', e)
      }
    }
  }, [])

  const handleSearch = async (query: string) => {
    if (!query.trim()) return

    setSearchQuery(query)
    setLoading(true)
    setSearched(true)

    try {
      const response = await client.retrieveKnowledge(query, { topK: 10 })
      setResults(response.results || [])

      // 保存搜索历史
      const newHistory = [query, ...recentSearches.filter(s => s !== query)].slice(0, 5)
      setRecentSearches(newHistory)
      localStorage.setItem('recent_searches', JSON.stringify(newHistory))
    } catch (error) {
      console.error('知识检索失败:', error)
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  const clearHistory = () => {
    setRecentSearches([])
    localStorage.removeItem('recent_searches')
  }

  const getSourceColor = (source: string): string => {
    switch (source) {
      case 'law': return 'blue'
      case 'regulation': return 'green'
      case 'case': return 'orange'
      default: return 'default'
    }
  }

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'law': return <ThunderboltOutlined />
      case 'regulation': return <FireOutlined />
      default: return <BookOutlined />
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Title level={2}>法律知识检索</Title>
      <Text type="secondary">搜索法条、案例、法规等法律知识</Text>

      {/* 搜索框 */}
      <div style={{ marginTop: 24, marginBottom: 24 }}>
        <Input.Search
          placeholder="输入关键词搜索法律知识..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onSearch={handleSearch}
          enterButton={
            <Space>
              <SearchOutlined />
              搜索
            </Space>
          }
          size="large"
          loading={loading}
        />

        <Space style={{ marginTop: 12 }} wrap>
          <Text type="secondary">热门：</Text>
          {HOT_SEARCHES.map((term) => (
            <Tag
              key={term}
              color="blue"
              style={{ cursor: 'pointer' }}
              onClick={() => handleSearch(term)}
            >
              {term}
            </Tag>
          ))}
        </Space>
      </div>

      {/* 分类筛选 */}
      <Space style={{ marginBottom: 16 }}>
        <Select
          value={category}
          onChange={setCategory}
          style={{ width: 120 }}
          options={[
            { value: 'all', label: '全部' },
            { value: 'law', label: '法律' },
            { value: 'regulation', label: '法规' },
            { value: 'case', label: '案例' },
          ]}
        />
      </Space>

      {/* 搜索结果 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
            正在检索法律知识库...
          </Text>
        </div>
      ) : searched ? (
        results.length > 0 ? (
          <List
            dataSource={results}
            pagination={{
              pageSize: 10,
              showSizeChanger: false,
            }}
            renderItem={(item, index) => (
              <List.Item>
                <Card
                  hoverable
                  style={{ width: '100%' }}
                  actions={[
                    <Tag key="source" color={getSourceColor(item.source)}>
                      {getSourceIcon(item.source)} {item.source}
                    </Tag>,
                    <Tag key="relevance" color="green">
                      {(item.relevance * 100).toFixed(1)}%
                    </Tag>,
                  ]}
                >
                  <Card.Meta
                    title={
                      <Space>
                        <span>{index + 1}.</span>
                        <Text strong style={{ fontSize: 16 }}>{item.title}</Text>
                      </Space>
                    }
                    description={
                      <div>
                        <ReactMarkdown
                          rehypePlugins={[rehypeHighlight]}
                          children={item.content.substring(0, 300) + '...'}
                        />
                        {item.citation && (
                          <div style={{ marginTop: 8 }}>
                            <LawCitation law="" article={item.citation} />
                          </div>
                        )}
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          ID: {item.id}
                        </Text>
                      </div>
                    }
                  />
                </Card>
              </List.Item>
            )}
          />
        ) : (
          <Empty
            description="未找到相关结果，请尝试其他关键词"
            style={{ marginTop: 40 }}
          >
            <Button type="primary" onClick={() => handleSearch('民法典')}>
              试试"民法典"
            </Button>
          </Empty>
        )
      ) : (
        /* 推荐搜索 */
        <div style={{ textAlign: 'center', padding: 40 }}>
          <BookOutlined style={{ fontSize: 64, color: '#d9d9d9' }} />
          <div style={{ marginTop: 16 }}>
            <Text type="secondary">搜索法律知识，获取专业法律信息</Text>
          </div>
          <div style={{ marginTop: 24 }}>
            <Text type="secondary">推荐阅读：</Text>
            <Space style={{ marginTop: 8 }}>
              {['民法典总则', '合同法', '劳动法'].map((term) => (
                <Tag
                  key={term}
                  color="cyan"
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleSearch(term)}
                >
                  {term}
                </Tag>
              ))}
            </Space>
          </div>
        </div>
      )}

      {/* 搜索历史 */}
      {recentSearches.length > 0 && !searched && (
        <div style={{ marginTop: 24 }}>
          <Space>
            <Text type="secondary">最近搜索：</Text>
            {recentSearches.map((term) => (
              <Tag
                key={term}
                style={{ cursor: 'pointer' }}
                onClick={() => handleSearch(term)}
              >
                {term}
              </Tag>
            ))}
            <Button type="link" size="small" onClick={clearHistory}>
              清空
            </Button>
          </Space>
        </div>
      )}
    </div>
  )
}
