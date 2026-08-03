/**
 * 错误处理测试
 */
import { describe, it, expect } from 'vitest'
import { ApiErrorClass } from '../index'

describe('ApiErrorClass', () => {
  it('应该创建正确的错误信息', () => {
    const error = new ApiErrorClass({
      code: 'AUTH_001',
      message: 'Token过期',
    })

    expect(error.code).toBe('AUTH_001')
    expect(error.message).toBe('Token过期')
    expect(error.name).toBe('ApiError')
  })

  it('应该包含详细信息', () => {
    const error = new ApiErrorClass({
      code: 'VALID_001',
      message: '参数校验失败',
      details: { field: 'username' },
    })

    expect(error.details).toEqual({ field: 'username' })
  })

  it('应该有 stack 属性', () => {
    const error = new ApiErrorClass({
      code: 'SYS_001',
      message: '系统错误',
    })

    expect(error.stack).toBeDefined()
    expect(typeof error.stack).toBe('string')
  })
})
