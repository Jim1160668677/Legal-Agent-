/**
 * HttpExceptionFilter 单元测试（A1-W1 全局异常过滤器）。
 *
 * 覆盖：
 *   - HttpException 带 code/message → 信封透传 + 对应 status
 *   - HttpException 无 code → code = status × 10
 *   - 原生 Error → 500/5001 + 不外泄内部消息
 *   - X-Trace-Id 头回写 + 无头时生成 traceId
 *   - SSE headersSent 时静默（不发响应）
 *
 * 设计依据：A1 §三 common/filters + §八错误码体系。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HttpException,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

function makeHost(req: Record<string, unknown> = {}, res: Record<string, unknown> = {}) {
  const status = vi.fn();
  const header = vi.fn();
  const json = vi.fn();
  const mockRes = {
    status: vi.fn(() => mockRes),
    header: vi.fn(() => mockRes),
    json: vi.fn(),
    headersSent: false,
    ...res,
  };
  mockRes.status = status.mockReturnValue(mockRes);
  mockRes.header = header.mockReturnValue(mockRes);
  mockRes.json = json;
  return {
    host: {
      switchToHttp: () => ({
        getResponse: () => mockRes,
        getRequest: () => ({
          method: 'GET',
          url: '/v1/test',
          headers: {},
          ...req,
        }),
      }),
    } as never,
    status,
    header,
    json,
    mockRes,
  };
}

describe('HttpExceptionFilter（统一错误信封）', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  it('HttpException 带业务 code/message → 透传 + 对应 status', () => {
    const { host, status, json } = makeHost({ headers: { 'x-trace-id': 'tr-1' } });
    filter.catch(new HttpException({ code: 8013, message: '合规拦截' }, 403), host);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      code: 8013,
      message: '合规拦截',
      traceId: 'tr-1',
      data: null,
    });
  });

  it('NotFoundException → 404 + code = status × 10', () => {
    const { host, status, json } = makeHost();
    filter.catch(new NotFoundException('not found'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    const envelope = json.mock.calls[0][0];
    expect(envelope.code).toBe(4040);
    expect(envelope.message).toBe('not found');
    expect(envelope.traceId).toBeTruthy();
  });

  it('BadRequestException → 400 + code = status × 10', () => {
    const { host, json } = makeHost();
    filter.catch(new BadRequestException('page must be >= 1'), host);
    expect(json.mock.calls[0][0].code).toBe(4000);
  });

  it('原生 Error → 500/5001 + 不外泄内部消息', () => {
    const { host, status, json } = makeHost();
    filter.catch(new Error('MongoDB connection string: mongodb://secret:pass@host'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const envelope = json.mock.calls[0][0];
    expect(envelope.code).toBe(5001);
    expect(envelope.message).toBe('内部错误');
    expect(envelope.message).not.toContain('mongodb');
  });

  it('无 X-Trace-Id 头 → 生成 traceId', () => {
    const { host, json } = makeHost();
    filter.catch(new BadRequestException('x'), host);
    const envelope = json.mock.calls[0][0];
    expect(envelope.traceId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('SSE 响应头已发送 → 静默不发错误响应', () => {
    const { host, status, json } = makeHost({}, { headersSent: true });
    filter.catch(new Error('stream error'), host);
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });
});