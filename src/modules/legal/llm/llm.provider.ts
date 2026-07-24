/**
 * LLM Provider 桥接（A1-W4 迁移）。
 *
 * 将现有 LlmService 层（src/services/legal/llm/*）迁移为 NestJS Provider，
 * 通过 LLM_SERVICE_TOKEN 注入 IntentRouter / OrchestratorService。
 *
 * 配置桥接：
 *   现有 createDefaultRegistry 期望旧 AppConfig（src/config/types.ts）：
 *     { llm: { provider, timeoutMs, maxRetries, baseRetryDelayMs, logLevel },
 *       agnes: { apiKey, baseURL, defaultModel }, qwen: { apiKey, baseURL, defaultModel } }
 *   NestJS 新配置（src/app-config）结构为：
 *     { llm: { provider, agnes: { apiKey, baseUrl, defaultModel }, timeoutMs, ... } }
 *   差异点：agnes.baseUrl → agnes.baseURL（驼峰命名）；无 qwen；无 logLevel。
 *   此处做结构适配，无需改动现有 llm 层 105 测试（原样复用）。
 *
 * dev 模式 AGNES_API_KEY 允许为空：Provider 仍创建，实际 LLM 调用时由
 * AgnesProvider 报错，OrchestratorService 捕获后降级到人工引导（07 §1.4）。
 *
 * 设计依据：A1-W4 迁移要点；development-plan.md A1-W4。
 */
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LlmService } from '../../../types/llm';
import { LlmServiceImpl } from '../../../services/legal/llm';
import { createDefaultRegistry } from '../../../services/legal/llm/registry';
import type { AppConfig as LegacyAppConfig } from '../../../config/types';
import { LLM_SERVICE_TOKEN } from '../intent/intent-router.service';

/**
 * 从 NestJS ConfigService 构建旧版 AppConfig 结构，供 createDefaultRegistry 复用。
 * 隔离新旧配置差异，避免污染现有 llm 层。
 */
function buildLegacyConfig(config: ConfigService): LegacyAppConfig {
  const provider = config.get<'agnes' | 'qwen'>('app.llm.provider') ?? 'agnes';
  const agnesApiKey = config.get<string>('app.llm.agnes.apiKey') ?? '';
  const agnesBaseUrl =
    config.get<string>('app.llm.agnes.baseUrl') ?? 'https://apihub.agnes-ai.com/v1';
  const agnesModel = config.get<string>('app.llm.agnes.defaultModel') ?? 'agnes-2.0-flash';

  return {
    llm: {
      provider,
      timeoutMs: config.get<number>('app.llm.timeoutMs') ?? 30000,
      maxRetries: config.get<number>('app.llm.maxRetries') ?? 3,
      baseRetryDelayMs: config.get<number>('app.llm.baseRetryDelayMs') ?? 1000,
      logLevel: 'info',
    },
    agnes: {
      apiKey: agnesApiKey,
      baseURL: agnesBaseUrl, // 新配置 baseUrl → 旧配置 baseURL
      defaultModel: agnesModel,
    },
    // qwen 当前为桩（QwenProvider 抛 NotImplemented），提供空配置占位
    qwen: {
      apiKey: config.get<string>('app.llm.qwen.apiKey') ?? '',
      baseURL: config.get<string>('app.llm.qwen.baseUrl') ?? '',
      defaultModel: config.get<string>('app.llm.qwen.defaultModel') ?? '',
    },
  };
}

/**
 * LLM_SERVICE_TOKEN 的 NestJS Provider 工厂。
 * 注：返回 LlmServiceImpl（实现 LlmService 接口），便于 IntentRouter/Orchestrator 注入。
 */
export const llmServiceProvider: Provider = {
  provide: LLM_SERVICE_TOKEN,
  inject: [ConfigService],
  useFactory: (config: ConfigService): LlmService => {
    const legacyCfg = buildLegacyConfig(config);
    const registry = createDefaultRegistry(legacyCfg);
    return new LlmServiceImpl(registry);
  },
};
