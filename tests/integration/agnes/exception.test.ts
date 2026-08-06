import { describe, it, expect, beforeAll } from 'vitest';
import {
  createServiceWithConfig,
  cloneConfig,
  hasAgnesKey,
  probeAgnesConnectivity,
  DEFAULT_OPTS,
} from '../../helpers/agnesFixture';
import { AuthError, TimeoutError, isLlmError } from '../../../src/services/legal/llm/errors';

/**
 * 异常场景集成测试 — 真实 Agnes API（需 key + 网络可达）。
 *
 * 覆盖可触发的网络依赖错误：auth / invalid_request。
 * 网络策略：key 缺失或网络不可达时跳过（本地错误场景见下方独立 describe）。
 */

describe.skipIf(!hasAgnesKey())('Agnes 异常场景（真实 API）', () => {
  let agnesReachable = false;

  // 连通性预检在 beforeAll 中执行（避免 top-level await 阻塞模块加载导致 vitest worker RPC 超时）
  beforeAll(async () => {
    agnesReachable = await probeAgnesConnectivity();
  }, 8_000);

  it('1. 错误 API key → AuthError（kind=auth，status=401，不可重试）', async (ctx) => {
    if (!agnesReachable) {
      ctx.skip();
      return;
    }
    const cfg = cloneConfig();
    cfg.agnes.apiKey = 'sk-invalid-key-for-exception-test';
    const service = createServiceWithConfig(cfg);

    let thrown: unknown;
    try {
      await service.generate('hi', { ...DEFAULT_OPTS, maxRetries: 0, timeoutMs: 15_000 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AuthError);
    const err = thrown as AuthError;
    expect(err.kind).toBe('auth');
    expect(err.status).toBe(401);
    expect(err.retryable).toBe(false);
  });

  it('2. 无效 model 名 → InvalidRequestError 或 ApiError', async (ctx) => {
    if (!agnesReachable) {
      ctx.skip();
      return;
    }
    const service = createServiceWithConfig(cloneConfig());
    let thrown: unknown;
    try {
      await service.generate('hi', {
        ...DEFAULT_OPTS,
        maxRetries: 0,
        timeoutMs: 15_000,
        model: 'agnes-nonexistent-model-xyz',
      });
    } catch (e) {
      thrown = e;
    }
    expect(isLlmError(thrown as Error)).toBe(true);
    const kind = (thrown as { kind: string }).kind;
    // 无效 model 应返回 4xx；网络抖动时也可能收到 network 错误（预检通过但测试时断网）
    expect(['invalid_request', 'api', 'network']).toContain(kind);
    console.log(`[exception] invalid model → ${kind}: ${(thrown as Error).message.slice(0, 80)}`);
  });
});

/**
 * 异常场景 — 本地错误处理（无网络依赖，始终运行）。
 *
 * 覆盖：timeout / 错误 baseURL / 外部 abort 信号。
 * 这些场景不调用真实 API（timeout=1ms 直接超时 / 无效 host DNS 失败 / 主动 abort），
 * 无需 AGNES_API_KEY 也无须网络可达，纯验证错误分类与可重试标记。
 */

describe('Agnes 异常场景（本地，无网络）', () => {
  it('3. timeoutMs=1 → TimeoutError（kind=timeout）', async () => {
    const service = createServiceWithConfig(cloneConfig());
    let thrown: unknown;
    try {
      await service.generate('请详细介绍中国法律体系。', {
        ...DEFAULT_OPTS,
        maxRetries: 0,
        timeoutMs: 1,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TimeoutError);
    expect((thrown as TimeoutError).kind).toBe('timeout');
    expect((thrown as TimeoutError).retryable).toBe(false);
  });

  it('4. 错误 baseURL → NetworkError（kind=network，可重试）', async () => {
    const cfg = cloneConfig();
    cfg.agnes.baseURL = 'https://invalid.agnes-ai-host.example/v1';
    const service = createServiceWithConfig(cfg);

    let thrown: unknown;
    try {
      await service.generate('hi', { ...DEFAULT_OPTS, maxRetries: 0, timeoutMs: 15_000 });
    } catch (e) {
      thrown = e;
    }
    // DNS 解析失败 → NetworkError；若 DNS 恰好超时也可能 TimeoutError
    expect(isLlmError(thrown as Error)).toBe(true);
    const kind = (thrown as { kind: string }).kind;
    expect(['network', 'timeout']).toContain(kind);
    console.log(`[exception] wrong baseURL → ${kind}: ${(thrown as Error).message.slice(0, 80)}`);
  });

  it('5. 外部 signal 取消 → TimeoutError 或 network 错误（abort 与网络错误竞态）', async () => {
    const service = createServiceWithConfig(cloneConfig());
    const ac = new AbortController();
    const promise = service.generate('请详细介绍中国法律体系的历史演进。', {
      ...DEFAULT_OPTS,
      maxRetries: 0,
      timeoutMs: 60_000,
      signal: ac.signal,
    });
    // 50ms 后取消
    setTimeout(() => ac.abort(new Error('cancelled by test')), 50);

    let thrown: unknown;
    try {
      await promise;
    } catch (e) {
      thrown = e;
    }
    expect(isLlmError(thrown as Error)).toBe(true);
    const kind = (thrown as { kind: string }).kind;
    // abort 与网络错误存在竞态：abort 触发时可能已发生网络错误（kind=network），
    // 也可能被 timeout 捕获（kind=timeout）。两者均符合预期。
    expect(['timeout', 'network']).toContain(kind);
    console.log(`[exception] external signal cancel → ${kind}`);
  });
});