/**
 * SDK 本地模式单元测试
 *
 * 覆盖：
 *   - LegalAgentClient.local() 工厂方法可用
 *   - 本地模式登录返回默认用户
 *   - 本地模式跳过网络请求
 *   - TypeScript 类型检查通过
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import LegalAgentClient, { ApiError } from '../index';
import type { LegalAgentConfig } from '../types';

describe('SDK Local Mode', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('LegalAgentClient.local() 工厂方法可用', () => {
    const client = LegalAgentClient.local();
    expect(client).toBeInstanceOf(LegalAgentClient);
  });

  it('本地模式客户端配置正确', () => {
    const client = LegalAgentClient.local();
    // 验证可以设置token
    client.setTokens('access-token', 'refresh-token');
    expect(client.isLoggedIn()).toBe(true);
    expect(client.getToken()).toBe('access-token');
  });

  it('本地模式登录返回默认用户，无需网络请求', async () => {
    const client = LegalAgentClient.local();
    const result = await client.login('phone', '13800138000');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.accessToken).toBe('local-token');
      expect(result.data.refreshToken).toBe('local-refresh');
      expect(result.data.userId).toBe('local-user');
      expect(result.data.isNewUser).toBe(true);
    }
    // 验证没有发起网络请求
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('本地模式无需传入 provider 和 externalId', async () => {
    const client = LegalAgentClient.local();
    const result = await client.login('phone', '');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.userId).toBe('local-user');
    }
  });

  it('本地模式登录后可以正常使用其他方法', async () => {
    const client = LegalAgentClient.local();
    const loginResult = await client.login('phone', 'test');
    expect(loginResult.ok).toBe(true);
    if (loginResult.ok) {
      client.setTokens(loginResult.data.accessToken, loginResult.data.refreshToken);
    }
    expect(client.isLoggedIn()).toBe(true);
    // 本地模式下其他方法仍会发起请求（因为本地后端会处理）
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ code: 0, data: { agents: [] }, traceId: 't1' }),
      text: () => Promise.resolve(''),
    } as unknown as Response);
    const agentsResult = await client.listAgents();
    expect(agentsResult.ok).toBe(true);
  });

  it('非本地模式客户端行为不变', async () => {
    const client = new LegalAgentClient({ baseUrl: 'https://api.test.com' });
    expect(client.isLoggedIn()).toBe(false);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        code: 0,
        data: { accessToken: 'at', refreshToken: 'rt', userId: 'u1', isNewUser: false },
        traceId: 't1',
      }),
      text: () => Promise.resolve(''),
    } as unknown as Response);
    const result = await client.login('phone', '13800138000');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.userId).toBe('u1');
    }
    // 非本地模式需要网络请求
    expect(fetchMock).toHaveBeenCalled();
  });

  it('构造函数支持 localMode 配置', () => {
    const config: LegalAgentConfig = {
      baseUrl: 'http://localhost:3000',
      clientType: 'local',
      localMode: true,
    };
    const client = new LegalAgentClient(config);
    expect(client).toBeInstanceOf(LegalAgentClient);
  });
});
