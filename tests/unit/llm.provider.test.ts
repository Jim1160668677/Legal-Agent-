/**
 * llm.provider 单元测试（A3-W1 新旧配置桥接 buildLegacyConfig）。
 *
 * 覆盖：
 *   - 默认值（provider=agnes、默认 baseUrl/model/超时）
 *   - 新配置 agnes.baseUrl → 旧配置 agnes.baseURL 驼峰映射
 *   - zhipu 配置透传 + 默认 glm-4.7-flash
 *   - qwen 桩配置默认空
 *
 * 设计依据：A3-W1 实施计划阶段 4。
 */
import { describe, it, expect } from 'vitest';
import { buildLegacyConfig } from '../../src/modules/legal/llm/llm.provider';

function makeConfig(values: Record<string, unknown> = {}) {
  return {
    get: (key: string) => (key in values ? values[key] : undefined),
  } as never;
}

describe('buildLegacyConfig', () => {
  it('空配置 → 全部默认值', () => {
    const cfg = buildLegacyConfig(makeConfig());
    expect(cfg.llm.provider).toBe('agnes');
    expect(cfg.llm.timeoutMs).toBe(30000);
    expect(cfg.llm.maxRetries).toBe(3);
    expect(cfg.llm.baseRetryDelayMs).toBe(1000);
    expect(cfg.llm.logLevel).toBe('info');
    expect(cfg.agnes).toEqual({
      apiKey: '',
      baseURL: 'https://apihub.agnes-ai.com/v1',
      defaultModel: 'agnes-2.0-flash',
    });
    expect(cfg.zhipu.baseURL).toBe('https://open.bigmodel.cn/api/paas/v4');
    expect(cfg.zhipu.defaultModel).toBe('glm-4.7-flash');
    expect(cfg.qwen).toEqual({ apiKey: '', baseURL: '', defaultModel: '' });
  });

  it('自定义值透传 + agnes.baseUrl → baseURL 映射', () => {
    const cfg = buildLegacyConfig(
      makeConfig({
        'app.llm.provider': 'zhipu',
        'app.llm.timeoutMs': 15000,
        'app.llm.maxRetries': 1,
        'app.llm.baseRetryDelayMs': 500,
        'app.llm.agnes.apiKey': 'ak-1',
        'app.llm.agnes.baseUrl': 'https://custom.agnes/v1',
        'app.llm.agnes.defaultModel': 'agnes-2.1',
        'app.llm.zhipu.apiKey': 'zk-1',
        'app.llm.zhipu.baseUrl': 'https://custom.zhipu/v4',
        'app.llm.zhipu.defaultModel': 'glm-5',
      }),
    );

    expect(cfg.llm.provider).toBe('zhipu');
    expect(cfg.llm.timeoutMs).toBe(15000);
    expect(cfg.agnes.baseURL).toBe('https://custom.agnes/v1');
    expect(cfg.agnes.defaultModel).toBe('agnes-2.1');
    expect(cfg.zhipu).toEqual({
      apiKey: 'zk-1',
      baseURL: 'https://custom.zhipu/v4',
      defaultModel: 'glm-5',
    });
  });
});