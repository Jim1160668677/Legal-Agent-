/**
 * VisionService 单元测试（v2.4 图像识别多模型主备切换）。
 *
 * 覆盖：
 *   - recognize：主 provider 成功 → 返回结果 + success 审计 + fallbackUsed=false
 *   - recognize：主失败备成功 → 故障切换 + fallbackUsed=true + 记录失败/成功
 *   - recognize：全部 provider 失败 → 抛 VisionAllProvidersFailedError + 累积 failures
 *   - recognize：空 registry → 抛错
 *   - getProviderStatus：返回健康状态
 *
 * 设计依据：图像识别系统-多模型主备切换.md §1.4 + §故障切换流程。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VisionService } from '../../src/modules/legal/vision/vision.service';
import { VisionProviderRegistry } from '../../src/modules/legal/vision/vision-provider-registry';
import { VisionAllProvidersFailedError } from '../../src/modules/legal/vision/vision.types';
import type { VisionProvider, VisionResult } from '../../src/modules/legal/vision/vision.types';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
}

function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn() };
}

/** 构造 provider：priority 按序，可配置 recognize 行为 */
function makeProvider(
  name: string,
  priority: number,
  behavior: 'success' | 'fail' = 'success',
  result: Partial<VisionResult> = {},
): VisionProvider {
  return {
    name,
    model: `model-${name}`,
    priority,
    recognize: vi.fn().mockImplementation(async () => {
      if (behavior === 'fail') throw new Error(`${name} 服务不可用`);
      return { text: `识别结果-${name}`, model: `model-${name}`, usage: undefined, ...result };
    }),
    healthCheck: vi.fn().mockResolvedValue(true),
  } as unknown as VisionProvider;
}

describe('VisionService（图像识别多模型主备切换，v2.4）', () => {
  let service: VisionService;
  let registry: VisionProviderRegistry;
  let audit: ReturnType<typeof makeAudit>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    registry = new VisionProviderRegistry(30_000);
    audit = makeAudit();
    logger = makeLogger();
    service = new VisionService(registry, audit as never, logger as never);
  });

  const input = { image: 'https://example.com/doc.png', prompt: '识别文字' };

  // ===== recognize：主 provider 成功 =====

  it('主 provider 成功 → 直接返回 + success 审计 + fallbackUsed=false', async () => {
    const primary = makeProvider('zhipu-flash', 1);
    registry.registerAll([primary]);

    const result = await service.recognize(input);

    expect(result.provider).toBe('zhipu-flash');
    expect(result.fallbackUsed).toBe(false);
    expect(result.text).toBe('识别结果-zhipu-flash');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // 审计记录 success
    const auditCall = audit.write.mock.calls[0];
    expect(auditCall[0]).toBe('vision_call');
    expect(auditCall[1]).toMatchObject({ provider: 'zhipu-flash', success: true });
    expect(auditCall[2]).toEqual({ result: 'success' });
  });

  // ===== 故障切换 =====

  it('主失败备成功 → 故障切换 + fallbackUsed=true', async () => {
    const primary = makeProvider('zhipu-flash', 1, 'fail');
    const backup = makeProvider('zhipu-plus', 2);
    registry.registerAll([primary, backup]);

    const result = await service.recognize(input);

    expect(result.provider).toBe('zhipu-plus');
    expect(result.fallbackUsed).toBe(true);
    expect(result.text).toBe('识别结果-zhipu-plus');
    expect(logger.warn).toHaveBeenCalledWith(
      'Vision provider 失败，尝试下一个',
      expect.objectContaining({ provider: 'zhipu-flash' }),
    );
  });

  it('主失败备成功 → recordSuccess/recordFailure 被调用', async () => {
    const primary = makeProvider('zhipu-flash', 1, 'fail');
    const backup = makeProvider('zhipu-plus', 2);
    registry.registerAll([primary, backup]);
    const primarySpy = vi.spyOn(registry, 'recordFailure');
    const backupSpy = vi.spyOn(registry, 'recordSuccess');

    await service.recognize(input);

    expect(primarySpy).toHaveBeenCalled();
    expect(backupSpy).toHaveBeenCalled();
  });

  // ===== 全部失败 =====

  it('全部 provider 失败 → 抛 VisionAllProvidersFailedError + 累积 failures', async () => {
    const primary = makeProvider('zhipu-flash', 1, 'fail');
    const backup = makeProvider('zhipu-plus', 2, 'fail');
    registry.registerAll([primary, backup]);

    const err = await service.recognize(input).then(
      () => undefined,
      (e) => e as VisionAllProvidersFailedError,
    );

    expect(err).toBeInstanceOf(VisionAllProvidersFailedError);
    expect(err!.failures).toHaveLength(2);
    expect(err!.failures.map((f) => f.provider)).toEqual(['zhipu-flash', 'zhipu-plus']);
  });

  // ===== 空 registry =====

  it('空 registry → 抛 VisionAllProvidersFailedError（failures 为空）', async () => {
    await expect(service.recognize(input)).rejects.toBeInstanceOf(
      VisionAllProvidersFailedError,
    );
  });

  // ===== 健康状态 =====

  it('getProviderStatus：返回按 priority 排序的状态', async () => {
    registry.registerAll([
      makeProvider('zhipu-plus', 2),
      makeProvider('zhipu-flash', 1),
    ]);

    const status = service.getProviderStatus();

    expect(status).toHaveLength(2);
    expect(status[0].priority).toBe(1);
    expect(status[0].name).toBe('zhipu-flash');
    expect(status[1].name).toBe('zhipu-plus');
    expect(status.every((s) => s.healthy)).toBe(true);
  });
});