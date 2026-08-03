/**
 * 个人中心页面 - 完整版本
 */
import { useState } from 'react'
import {
  Descriptions,
  Button,
  Avatar,
  Card,
  Typography,
  Space,
  Divider,
  Modal,
  Form,
  Input,
  Badge,
  List,
  Tag,
  Popconfirm,
} from 'antd'
import {
  UserOutlined,
  EditOutlined,
  SettingOutlined,
  FileTextOutlined,
  MessageOutlined,
  HistoryOutlined,
  BellOutlined,
  ShieldOutlined,
  LogoutOutlined,
  DeleteOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'

const { Title, Text } = Typography

export default function Profile() {
  const { user, logout } = useAuthStore()
  const [editModalVisible, setEditModalVisible] = useState(false)
  const [form] = Form.useForm()

  const handleEdit = () => {
    form.setFieldsValue(user?.profile || {})
    setEditModalVisible(true)
  }

  const handleSubmit = async (values: any) => {
    // TODO: 调用API更新用户资料
    console.log('Update profile:', values)
    setEditModalVisible(false)
  }

  const handleLogout = () => {
    logout()
    window.location.reload()
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* 用户信息卡片 */}
      <Card>
        <Space size="large" style={{ marginBottom: 24 }}>
          <Avatar size={80} icon={<UserOutlined />} style={{ background: '#1890ff' }} />
          <div>
            <Title level={4} style={{ margin: 0 }}>{user?.username}</Title>
            <Text type="secondary">
              {user?.role === 'admin' ? '管理员' : user?.role === 'lawyer' ? '律师' : '普通用户'}
            </Text>
            <Badge status="success" text="在线" style={{ marginLeft: 8 }} />
          </div>
          <Button icon={<EditOutlined />} onClick={handleEdit}>
            编辑资料
          </Button>
        </Space>

        <Divider />

        <Descriptions column={2} bordered>
          <Descriptions.Item label="用户名">{user?.username}</Descriptions.Item>
          <Descriptions.Item label="角色">
            <Tag color={user?.role === 'admin' ? 'red' : user?.role === 'lawyer' ? 'blue' : 'green'}>
              {user?.role === 'admin' ? '管理员' : user?.role === 'lawyer' ? '律师' : '普通用户'}
            </Tag>
          </Descriptions.Item>
          {user?.profile?.name && (
            <Descriptions.Item label="姓名">{user.profile.name}</Descriptions.Item>
          )}
          {user?.profile?.phone && (
            <Descriptions.Item label="电话">{user.profile.phone}</Descriptions.Item>
          )}
          {user?.profile?.email && (
            <Descriptions.Item label="邮箱">{user.profile.email}</Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* 快捷功能 */}
      <div style={{ marginTop: 24 }}>
        <Title level={5}>快捷功能</Title>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <QuickActionCard
            icon={<MessageOutlined />}
            title="历史对话"
            description="查看和继续之前的法律咨询"
            badge="12"
            action="开始对话"
            path="/chat"
          />
          <QuickActionCard
            icon={<FileTextOutlined />}
            title="案件分析"
            description="快速生成案件分析报告"
            action="新建分析"
            path="/analysis"
          />
          <QuickActionCard
            icon={<HistoryOutlined />}
            title="搜索历史"
            description="查看最近的法律知识检索记录"
            badge="5"
          />
        </Space>
      </div>

      {/* 设置选项 */}
      <div style={{ marginTop: 24 }}>
        <Title level={5}>设置</Title>
        <Card>
          <List
            dataSource={[
              { key: 'notifications', icon: <BellOutlined />, title: '消息通知', desc: '开启新消息提醒' },
              { key: 'security', icon: <ShieldOutlined />, title: '账号安全', desc: '修改密码、绑定手机' },
              { key: 'privacy', icon: <SettingOutlined />, title: '隐私设置', desc: '管理个人数据' },
            ]}
            renderItem={(item) => (
              <List.Item
                extra={<Button type="link">进入</Button>}
                style={{ cursor: 'pointer' }}
              >
                <List.Item.Meta
                  avatar={<Avatar icon={item.icon} style={{ background: '#1890ff' }} />}
                  title={item.title}
                  description={item.desc}
                />
              </List.Item>
            )}
          />
        </Card>
      </div>

      {/* 退出登录 */}
      <div style={{ marginTop: 24, textAlign: 'center' }}>
        <Popconfirm
          title="确定要退出登录吗？"
          onConfirm={handleLogout}
          okText="退出"
          cancelText="取消"
        >
          <Button danger icon={<LogoutOutlined />} size="large">
            退出登录
          </Button>
        </Popconfirm>
      </div>

      {/* 编辑资料弹窗 */}
      <Modal
        title="编辑个人资料"
        open={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        onOk={() => form.submit()}
        width={500}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="姓名">
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="电话">
            <Input />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input type="email" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

// 快捷功能卡片
function QuickActionCard({
  icon,
  title,
  description,
  badge,
  action,
  path,
}: {
  icon: React.ReactNode
  title: string
  description: string
  badge?: string
  action?: string
  path?: string
}) {
  return (
    <Card
      hoverable
      style={{ cursor: 'pointer' }}
      actions={[
        action ? <Button key="action" type="primary" size="small">{action}</Button> : null,
      ].filter(Boolean)}
    >
      <Card.Meta
        avatar={<Avatar icon={icon} style={{ background: '#1890ff' }} />}
        title={
          <Space>
            <span>{title}</span>
            {badge && <Badge count={badge} />}
          </Space>
        }
        description={description}
      />
    </Card>
  )
}
