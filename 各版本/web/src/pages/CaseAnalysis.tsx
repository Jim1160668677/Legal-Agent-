/**
 * 案件分析页面 - 完整版本
 */
import { useState, useEffect } from 'react'
import {
  Form,
  Input,
  Select,
  Button,
  Card,
  Typography,
  Space,
  Tag,
  Alert,
  Spin,
  Steps,
  Descriptions,
  Collapse,
  Drawer,
} from 'antd'
import {
  FileTextOutlined,
  SafetyOutlined,
  CheckCircleOutlined,
  BulbOutlined,
  ThunderboltOutlined,
  HistoryOutlined,
} from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import { LegalAgentClient, type AnalysisResult } from '@legal-agent/sdk'
import LawCitation from '../components/LawCitation'
import { AnalysisSkeleton } from '../components/Skeleton'

const { Title, Text } = Typography
const { TextArea } = Input
const { Panel } = Collapse

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''
const client = new LegalAgentClient({ baseUrl: API_BASE_URL })

export default function CaseAnalysis() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form] = Form.useForm()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<AnalysisResult[]>([])

  // 加载历史记录
  useEffect(() => {
    const saved = localStorage.getItem('analysis_history')
    if (saved) {
      try {
        setHistory(JSON.parse(saved))
      } catch (e) {
        console.error('解析历史记录失败:', e)
      }
    }
  }, [])

  const handleSubmit = async (values: any) => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await client.analyzeCase(values.caseType, values.facts, {
        requirements: values.requirements,
      })
      setResult(response)
      
      // 保存历史
      const newHistory = [response, ...history].slice(0, 10)
      setHistory(newHistory)
      localStorage.setItem('analysis_history', JSON.stringify(newHistory))
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '分析失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const loadFromHistory = (item: AnalysisResult) => {
    setResult(item)
    setHistoryOpen(false)
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* 头部 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={2}>案件分析</Title>
          <Text type="secondary">输入案件信息，AI将为您提供专业的法律分析和建议</Text>
        </div>
        <Button
          icon={<HistoryOutlined />}
          onClick={() => setHistoryOpen(true)}
          disabled={history.length === 0}
        >
          历史记录 ({history.length})
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 24 }}>
        {/* 表单区域 */}
        <Card style={{ flex: 1 }} title={<span><FileTextOutlined /> 案件信息</span>}>
          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            initialValues={{ caseType: 'contract' }}
          >
            <Form.Item
              name="caseType"
              label="案件类型"
              rules={[{ required: true, message: '请选择案件类型' }]}
            >
              <Select
                placeholder="选择案件类型"
                options={[
                  { value: 'contract', label: '合同纠纷', icon: '📄' },
                  { value: 'labor', label: '劳动争议', icon: '👷' },
                  { value: 'property', label: '房产纠纷', icon: '🏠' },
                  { value: 'marriage', label: '婚姻家庭', icon: '💑' },
                  { value: 'tort', label: '侵权纠纷', icon: '⚠️' },
                  { value: 'criminal', label: '刑事案件', icon: '🔒' },
                  { value: 'commercial', label: '商事纠纷', icon: '💼' },
                  { value: 'inheritance', label: '继承纠纷', icon: '📜' },
                ]}
              />
            </Form.Item>

            <Form.Item
              name="facts"
              label="案件事实"
              rules={[
                { required: true, message: '请输入案件事实' },
                { min: 50, message: '请详细描述案件情况（至少50字）' },
              ]}
            >
              <TextArea
                rows={10}
                placeholder={`请详细描述案件情况，包括：\n1. 当事人信息\n2. 事件经过\n3. 争议焦点\n4. 相关证据`}
                showCount
              />
            </Form.Item>

            <Form.Item name="requirements" label="您的诉求">
              <TextArea
                rows={3}
                placeholder="您希望通过法律途径达到什么目的？例如：要求赔偿、解除合同等"
              />
            </Form.Item>

            <Form.Item>
              <Space>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={loading}
                  icon={<ThunderboltOutlined />}
                  size="large"
                >
                  开始分析
                </Button>
                <Button onClick={() => form.resetFields()} size="large">
                  重置
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Card>

        {/* 结果区域 */}
        <Card
          style={{ flex: 1, height: 'fit-content' }}
          title={<span><CheckCircleOutlined /> 分析结果</span>}
          loading={loading}
        >
          {error && (
            <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />
          )}

          {!result && !loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <BulbOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />
              <div style={{ marginTop: 16 }}>
                <Text type="secondary">填写案件信息后点击分析</Text>
              </div>
            </div>
          ) : result ? (
            <AnalysisResultView result={result} />
          ) : (
            <AnalysisSkeleton />
          )}
        </Card>
      </div>

      {/* 历史记录抽屉 */}
      <Drawer
        title="分析历史"
        placement="right"
        width={400}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      >
        {history.length === 0 ? (
          <Empty description="暂无历史记录" />
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {history.map((item, index) => (
              <Card
                key={index}
                hoverable
                size="small"
                onClick={() => loadFromHistory(item)}
              >
                <Text strong>{item.caseType}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {new Date().toLocaleString()}
                </Text>
              </Card>
            ))}
          </Space>
        )}
      </Drawer>
    </div>
  )
}

// 分析结果视图组件
function AnalysisResultView({ result }: { result: AnalysisResult }) {
  return (
    <Steps
      current={1}
      style={{ marginBottom: 16 }}
      items={[
        { title: '提交案件' },
        { title: 'AI分析' },
        { title: '查看结果' },
      ]}
    />
  )
}
