/**
 * LLM 配置桥接（A1-W4 迁移，A3-W1 重构）。
 *
 * A3-W1 起，LLM_SERVICE_TOKEN 由 LlmModule 装配（CachedLlmService 包装 legacy）。
 * 本文件仅保留 buildLegacyConfig 工具函数，供 LlmModule 的 LEGACY_LLM_TOKEN 工厂复用。
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
 * 设计依据：A3-W1 实施计划阶段 4；A1-W4 迁移要点。
 */
import type { ConfigService } from '@nestjs/config';
import type { AppConfig as LegacyAppConfig } from '../../../config/types';

/**
 * 从 NestJS ConfigService 构建旧版 AppConfig 结构，供 createDefaultRegistry 复用。
 * 隔离新旧配置差异，避免污染现有 llm 层。
 */
export function buildLegacyConfig(config: ConfigService): LegacyAppConfig {
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
