/**
 * 法律知识页面
 */
import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '../../stores/auth'

interface KnowledgeResult {
  id: string
  title: string
  content: string
  source: 'law' | 'regulation' | 'case' | 'article'
  relevance: number
  citation: string
}

const CATEGORIES = ['全部', '法律', '法规', '案例', '学术文章']
const SOURCES: Record<string, { label: string; color: string }> = {
  law: { label: '法律', color: '#1890ff' },
  regulation: { label: '法规', color: '#52c41a' },
  case: { label: '案例', color: '#fa8c16' },
  article: { label: '文章', color: '#722ed1' },
}

const HOT_KEYWORDS = ['劳动合同', '离婚财产', '交通事故', '民间借贷', '房屋买卖', '知识产权', '债务纠纷']

export default function Knowledge() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('全部')
  const [results, setResults] = useState<KnowledgeResult[]>([])
  const [loading, setLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  if (!isAuthenticated) {
    window.location.href = '/login'
    return null
  }

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return
    setLoading(true)
    setHasSearched(true)
    try {
      const { getApiService } = await import('../../services/api')
      const apiService = getApiService()
      const res = await apiService.retrieveKnowledge(query, {
        category: category === '全部' ? undefined : category,
      })
      setResults(res.results)
    } catch (err: any) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }, [query, category])

  useEffect(() => {
    if (query.trim().length >= 2) {
      const timer = setTimeout(() => handleSearch(), 500)
      return () => clearTimeout(timer)
    }
  }, [query, category, handleSearch])

  return (
    <div className="page knowledge-page">
      <div className="knowledge-search">
        <input
          className="search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索法律知识..."
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        {query && (
          <button className="clear-btn" onClick={() => { setQuery(''); setResults([]); setHasSearched(false); }}>×</button>
        )}
        <button className="search-btn" disabled={loading} onClick={handleSearch}>
          搜索
        </button>
      </div>

      <div className="category-bar">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={`category-item ${category === cat ? 'category-active' : ''}`}
            onClick={() => setCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {!hasSearched && (
        <div className="hot-keywords">
          <span className="keywords-title">热门搜索</span>
          <div className="keywords-list">
            {HOT_KEYWORDS.map((kw) => (
              <button key={kw} className="keyword-item" onClick={() => setQuery(kw)}>
                {kw}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="results-list">
        {loading && (
          <div className="loading-tip">
            <span>搜索中...</span>
          </div>
        )}
        {!loading && hasSearched && results.length === 0 && (
          <div className="empty-result">
            <span>暂无相关结果</span>
          </div>
        )}
        {!loading && results.map((item) => (
          <div key={item.id} className="result-item">
            <div className="result-header">
              <span className="result-title">{item.title}</span>
              <div className="result-source" style={{ backgroundColor: SOURCES[item.source]?.color }}>
                <span className="source-text">{SOURCES[item.source]?.label}</span>
              </div>
            </div>
            <span className="result-content">{item.content}</span>
            <div className="result-footer">
              <span className="result-citation">{item.citation}</span>
              <span className="result-relevance">相关度: {(item.relevance * 100).toFixed(0)}%</span>
            </div>
          </div>
        ))}
        {!hasSearched && (
          <div className="hint-tip">
            <span>输入关键词搜索法律条文、法规、案例和学术文章</span>
          </div>
        )}
      </div>
    </div>
  )
}
