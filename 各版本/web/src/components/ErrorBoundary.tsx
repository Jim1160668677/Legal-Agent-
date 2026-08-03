/**
 * 错误边界组件
 */
import { Component, ErrorInfo, ReactNode } from 'react'
import { Result, Button } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo)
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <Result
          status="error"
          title="页面出现错误"
          subTitle={this.state.error?.message || '请稍后重试'}
          extra={[
            <Button
              type="primary"
              key="reload"
              icon={<ReloadOutlined />}
              onClick={() => window.location.reload()}
            >
              刷新页面
            </Button>,
          ]}
        />
      )
    }

    return this.props.children
  }
}
