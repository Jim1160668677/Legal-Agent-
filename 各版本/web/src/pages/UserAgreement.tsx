/**
 * 用户协议页面
 */
import { Typography, Card } from 'antd'

const { Title, Paragraph } = Typography

export default function UserAgreement() {
  return (
    <div style={{ maxWidth: 800, margin: '40px auto', padding: '0 20px' }}>
      <Card>
        <Title level={2}>用户协议</Title>
        <Paragraph>
          欢迎使用法律智能体。使用本服务即表示您同意遵守以下协议。
        </Paragraph>
        <Paragraph>
          1. 服务内容：法律智能体提供法律咨询、文书生成、案例分析等AI辅助法律服务。
        </Paragraph>
        <Paragraph>
          2. 用户责任：用户应确保提供的信息真实准确，并合法使用本服务。
        </Paragraph>
        <Paragraph>
          3. 知识产权：服务内容和输出成果的知识产权归用户所有，但需遵守相关法律法规。
        </Paragraph>
        <Paragraph>
          4. 免责声明：本服务仅提供辅助参考，不构成法律意见，用户应自行判断和决策。
        </Paragraph>
        <Paragraph>
          5. 服务变更：我们保留根据法律法规调整服务内容和服务条款的权利。
        </Paragraph>
      </Card>
    </div>
  )
}
