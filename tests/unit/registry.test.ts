import { describe, it, expect } from 'vitest';
import { ProviderRegistry, createDefaultRegistry } from '../../src/services/legal/llm/registry';
import type { LlmProvider } from '../../src/services/legal/llm/provider';
import { NotImplementedError } from '../../src/services/legal/llm/provider';
import type { QwenProvider } from '../../src/services/legal/llm/qwenProvider';
import type { ZhipuProvider } from '../../src/services/legal/llm/zhipuProvider';
import type { AppConfig } from '../../src/config/types';

/** 构造 mock provider */
function mockProvider(name: string, model = `model-${name}`): LlmProvider {
  return {
    name,
    defaultModel: model,
    async generate() {
      return {
        content: `from-${name}`,
        model,
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        raw: {},
      };
    },
    async *stream() {
      yield { delta: `from-${name}`, done: true };
    },
  };
}

/** 构造测试用 AppConfig（agnes + qwen + zhipu 均有占位 key） */
function makeCfg(provider: 'agnes' | 'qwen' | 'zhipu' = 'agnes'): AppConfig {
  return {
    llm: {
      provider,
      timeoutMs: 30_000,
      maxRetries: 3,
      baseRetryDelayMs: 1_000,
      logLevel: 'info',
    },
    agnes: {
      apiKey: 'sk-test',
      baseURL: 'https://apihub.agnes-ai.com/v1',
      defaultModel: 'agnes-2.0-flash',
    },
    qwen: {
      apiKey: 'sk-test',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      defaultModel: 'qwen-max',
    },
    zhipu: {
      apiKey: 'sk-test',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      defaultModel: 'glm-4.7-flash',
    },
  };
}

describe('ProviderRegistry', () => {
  it('register 后可 get/has', () => {
    const reg = new ProviderRegistry();
    const a = mockProvider('alpha');
    reg.register(a);
    expect(reg.has('alpha')).toBe(true);
    expect(reg.get('alpha')).toBe(a);
    expect(reg.has('beta')).toBe(false);
    expect(reg.get('beta')).toBeUndefined();
  });

  it('首个注册的 provider 自动设为 active', () => {
    const reg = new ProviderRegistry();
    reg.register(mockProvider('alpha'));
    reg.register(mockProvider('beta'));
    expect(reg.activeName).toBe('alpha');
    expect(reg.active.name).toBe('alpha');
  });

  it('setActive 切换 active provider', () => {
    const reg = new ProviderRegistry();
    reg.register(mockProvider('alpha'));
    reg.register(mockProvider('beta'));
    reg.setActive('beta');
    expect(reg.activeName).toBe('beta');
    expect(reg.active.name).toBe('beta');
  });

  it('setActive 未注册的 name 抛错', () => {
    const reg = new ProviderRegistry();
    reg.register(mockProvider('alpha'));
    expect(() => reg.setActive('gamma')).toThrow(/not registered/);
  });

  it('active 在无注册时抛错', () => {
    const reg = new ProviderRegistry();
    expect(() => reg.active).toThrow(/No active provider/);
  });

  it('list 返回所有已注册 provider', () => {
    const reg = new ProviderRegistry();
    reg.register(mockProvider('alpha'));
    reg.register(mockProvider('beta'));
    const list = reg.list();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.name).sort()).toEqual(['alpha', 'beta']);
  });

  it('register 同名覆盖', () => {
    const reg = new ProviderRegistry();
    const a1 = mockProvider('alpha', 'v1');
    const a2 = mockProvider('alpha', 'v2');
    reg.register(a1);
    reg.register(a2);
    expect(reg.get('alpha')).toBe(a2);
    expect(reg.get('alpha')?.defaultModel).toBe('v2');
    expect(reg.list()).toHaveLength(1);
  });

  it('active 委托调用 generate', async () => {
    const reg = new ProviderRegistry();
    reg.register(mockProvider('alpha'));
    const r = await reg.active.generate([{ role: 'user', content: 'hi' }]);
    expect(r.content).toBe('from-alpha');
  });

  it('active 委托调用 stream', async () => {
    const reg = new ProviderRegistry();
    reg.register(mockProvider('alpha'));
    const chunks: string[] = [];
    for await (const ch of reg.active.stream([{ role: 'user', content: 'hi' }])) {
      chunks.push(ch.delta);
    }
    expect(chunks.join('')).toBe('from-alpha');
  });
});

describe('createDefaultRegistry', () => {
  it('默认注册 agnes + qwen + zhipu，active 为 cfg.llm.provider', () => {
    const reg = createDefaultRegistry(makeCfg('agnes'));
    expect(reg.has('agnes')).toBe(true);
    expect(reg.has('qwen')).toBe(true);
    expect(reg.has('zhipu')).toBe(true);
    expect(reg.activeName).toBe('agnes');
    expect(reg.list()).toHaveLength(3);
  });

  it('provider=qwen 时 active 为 qwen', () => {
    const reg = createDefaultRegistry(makeCfg('qwen'));
    expect(reg.activeName).toBe('qwen');
    expect(reg.active.name).toBe('qwen');
  });

  it('provider=zhipu 时 active 为 zhipu（LLM_PROVIDER=zhipu 场景）', () => {
    const reg = createDefaultRegistry(makeCfg('zhipu'));
    expect(reg.activeName).toBe('zhipu');
    expect(reg.active.name).toBe('zhipu');
  });

  it('agnse/qwen/zhipu provider 默认模型正确', () => {
    const reg = createDefaultRegistry(makeCfg('agnes'));
    expect(reg.get('agnes')?.defaultModel).toBe('agnes-2.0-flash');
    expect(reg.get('qwen')?.defaultModel).toBe('qwen-max');
    expect(reg.get('zhipu')?.defaultModel).toBe('glm-4.7-flash');
  });

  it('QwenProvider 调用 generate 抛 NotImplementedError', async () => {
    const reg = createDefaultRegistry(makeCfg('qwen'));
    const qwen = reg.get('qwen') as QwenProvider;
    await expect(qwen.generate([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });

  it('QwenProvider 调用 stream 抛 NotImplementedError', async () => {
    const reg = createDefaultRegistry(makeCfg('qwen'));
    const qwen = reg.get('qwen') as QwenProvider;
    await expect(async () => {
      for await (const _ of qwen.stream([{ role: 'user', content: 'hi' }])) {
        // 迭代即抛
      }
    }).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('provider=zhipu 时 active 为真实 ZhipuProvider 实例', async () => {
    const reg = createDefaultRegistry(makeCfg('zhipu'));
    const zp = reg.get('zhipu') as ZhipuProvider;
    expect(zp.name).toBe('zhipu');
    expect(zp.defaultModel).toBe('glm-4.7-flash');
    expect(reg.active.name).toBe('zhipu');
    expect(() => reg.setActive('zhipu')).not.toThrow();
  });
});
