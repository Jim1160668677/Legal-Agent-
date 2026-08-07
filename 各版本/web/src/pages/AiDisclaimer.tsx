/**
 * AI免责声明页面
 */
import { Typography, Card } from 'antd'

const { Title, Paragraph } = Typography

export default function AiDisclaimer() {
  return (
    <div style={{ maxWidth: 800, margin: '40px auto', padding: '0 20px' }}>
      <Card>
        <Title level={2}>AI免责声明</Title>
        <Paragraph>
          法律智能体基于人工智能技术提供法律服务辅助，请注意以下事项：
        </Paragraph>
        <Paragraph>
          1. AI生成内容仅供参考：本服务提供的法律分析、文书模板等内容由AI生成，可能存在不准确之处。
        </Paragraph>
        <Paragraph>
          2. 不构成法律意见：AI服务不能替代专业律师的法律意见，重要决策请咨询专业法律人士。
        </Paragraph>
        <Paragraph>
          3. 信息准确性：用户应核实AI输出的法律依据和引用，确保信息的准确性和时效性。
        </Paragraph>
        <Paragraph>
          4. 局限性说明：AI模型存在知识更新延迟，对最新法律法规的覆盖可能存在滞后。
        </Paragraph>
        <Paragraph>
          5. 责任限制：因使用本服务产生的任何损失，我们不承担法律责任。
        </Paragraph>
      </Card>
    </div>
  )
}
