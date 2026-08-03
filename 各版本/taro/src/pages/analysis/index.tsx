/**
 * 案件分析页面
 */
import { useState } from 'react'
import { useAuthStore } from '../../stores/auth'

interface AnalysisResult {
  analysisId: string
  caseType: string
  irac: {
    issue: string[]
    rule: { law: string; article: string; content: string }[]
    analysis: { fact: string; rule: string; reasoning: string }[]
    conclusion: string
  }
  riskAssessment: {
    level: 'high' | 'medium' | 'low'
    factors: { name: string; score: number; description: string }[]
    suggestions: string[]
  }
  recommendations: { type: string; content: string; priority: string }[]
}

const CASE_TYPES = ['民事纠纷', '合同纠纷', '劳动争议', '知识产权', '刑事案件', '行政诉讼', '其他']

const RISK_COLORS: Record<string, string> = {
  high: '#f5222d',
  medium: '#fa8c16',
  low: '#52c41a',
}

export default function Analysis() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const [caseType, setCaseType] = useState('')
  const [facts, setFacts] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState('')

  if (!isAuthenticated) {
    window.location.href = '/login'
    return null
  }

  const handleAnalyze = async () => {
    if (!caseType) {
      setError('请选择案件类型')
      return
    }
    if (!facts.trim()) {
      setError('请输入案件事实')
      return
    }
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const { getApiService } = await import('../../services/api')
      const apiService = getApiService()
      const res = await apiService.analyzeCase(caseType, facts)
      setResult(res as AnalysisResult)
    } catch (err: any) {
      setError(err.message || '分析失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page analysis-page">
      <div className="analysis-header">
        <h1 className="header-title">案件分析</h1>
        <p className="header-subtitle">选择案件类型，描述案件事实，获取AI法律分析</p>
      </div>

      <div className="analysis-form">
        <div className="form-section">
          <label className="form-label">案件类型</label>
          <select className="picker-display" value={caseType} onChange={(e) => setCaseType(e.target.value)}>
            <option value="">请选择案件类型</option>
            {CASE_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>

        <div className="form-section">
          <label className="form-label">案件事实</label>
          <textarea
            className="facts-input"
            placeholder="请详细描述案件事实，包括时间、地点、人物、经过等关键信息..."
            value={facts}
            onChange={(e) => setFacts(e.target.value)}
            maxLength={2000}
            rows={6}
          />
          <span className="facts-count">{facts.length}/2000</span>
        </div>

        {error && <div className="form-error"><span>{error}</span></div>}

        <button className="analyze-btn" disabled={loading} onClick={handleAnalyze}>
          {loading ? '分析中...' : '开始分析'}
        </button>
      </div>

      {result && (
        <div className="analysis-result">
          <div className="result-section">
            <h2 className="section-title">📋 争议焦点</h2>
            {result.irac.issue.map((issue, i) => (
              <div key={i} className="issue-item">
                <span className="issue-text">{issue}</span>
              </div>
            ))}
          </div>

          <div className="result-section">
            <h2 className="section-title">⚖️ 法律依据</h2>
            {result.irac.rule.map((rule, i) => (
              <div key={i} className="rule-item">
                <span className="rule-law">{rule.law} 第{rule.article}条</span>
                <span className="rule-content">{rule.content}</span>
              </div>
            ))}
          </div>

          <div className="result-section">
            <h2 className="section-title">🔍 分析过程</h2>
            {result.irac.analysis.map((point, i) => (
              <div key={i} className="analysis-point">
                <span className="point-fact">事实：{point.fact}</span>
                <span className="point-rule">规则：{point.rule}</span>
                <span className="point-reasoning">{point.reasoning}</span>
              </div>
            ))}
          </div>

          <div className="result-section">
            <h2 className="section-title">✅ 结论</h2>
            <span className="conclusion-text">{result.irac.conclusion}</span>
          </div>

          <div className="result-section">
            <h2 className="section-title">⚠️ 风险评估</h2>
            <div className="risk-level" style={{ backgroundColor: RISK_COLORS[result.riskAssessment.level] }}>
              <span className="risk-text">
                {result.riskAssessment.level === 'high' ? '高风险' :
                 result.riskAssessment.level === 'medium' ? '中风险' : '低风险'}
              </span>
            </div>
            {result.riskAssessment.factors.map((factor, i) => (
              <div key={i} className="risk-factor">
                <span className="factor-name">{factor.name}</span>
                <span className="factor-desc">{factor.description}</span>
                <div className="risk-score">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <div key={s} className={`score-dot ${s <= factor.score ? 'score-dot-active' : ''}`} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="result-section">
            <h2 className="section-title">💡 建议措施</h2>
            {result.recommendations.map((rec, i) => (
              <div key={i} className={`recommendation ${rec.type}`}>
                <span>{rec.content}</span>
                <span className={`priority-${rec.priority}`}>
                  {rec.priority === 'high' ? '高' : rec.priority === 'medium' ? '中' : '低'}优先级
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
