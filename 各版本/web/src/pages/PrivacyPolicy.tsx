/**
 * 隐私政策页面
 */
import { Typography, Card } from 'antd'

const { Title, Paragraph } = Typography

export default function PrivacyPolicy() {
  return (
    <div style={{ maxWidth: 800, margin: '40px auto', padding: '0 20px' }}>
      <Card>
        <Title level={2}>隐私政策</Title>
        <Paragraph>
          法律智能体重视您的隐私保护。本政策说明我们如何收集、使用和保护您的个人信息。
        </Paragraph>
        <Paragraph>
          1. 信息收集：我们仅收集提供服务所必需的信息，包括您的账号信息和对话内容。
        </Paragraph>
        <Paragraph>
          2. 信息使用：收集的信息用于提供法律服务、改善产品体验和分析用户需求。
        </Paragraph>
        <Paragraph>
          3. 信息保护：我们采用加密存储和传输，严格控制数据访问权限。
        </Paragraph>
        <Paragraph>
          4. 第三方共享：未经您的同意，我们不会将个人信息分享给第三方。
        </Paragraph>
        <Paragraph>
          5. 您的权利：您有权访问、更正和删除您的个人信息。
        </Paragraph>
      </Card>
    </div>
  )
}
