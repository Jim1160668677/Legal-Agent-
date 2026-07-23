import dotenv from 'dotenv';
import { env } from './env';
import type { AppConfig } from './types';

// 自动加载 .env（若存在）；已存在的 process.env 优先（不覆盖）
dotenv.config({ override: false });

/**
 * 从环境变量加载并校验 AppConfig。
 * - 当 LLM_PROVIDER=agnes 时，AGNES_API_KEY 必填
 * - 当 LLM_PROVIDER=qwen 时，QWEN_API_KEY 必填（但 QwenProvider 当前为桩，调用时会抛 NotImplemented）
 */
export function loadConfig(): AppConfig {
  const provider = env.providerName('agnes');

  const agnesApiKey = process.env.AGNES_API_KEY ?? '';
  const qwenApiKey = process.env.QWEN_API_KEY ?? '';

  if (provider === 'agnes' && (!agnesApiKey || agnesApiKey.startsWith('sk-xxx'))) {
    throw new Error(
      'AGNES_API_KEY is required when LLM_PROVIDER=agnes. ' +
        'Copy .env.example to .env and fill in your real key.',
    );
  }
  if (provider === 'qwen' && (!qwenApiKey || qwenApiKey.trim() === '')) {
    throw new Error('QWEN_API_KEY is required when LLM_PROVIDER=qwen.');
  }

  const cfg: AppConfig = {
    llm: {
      provider,
      timeoutMs: env.int('LLM_TIMEOUT_MS', 30_000),
      maxRetries: env.int('LLM_MAX_RETRIES', 3),
      baseRetryDelayMs: env.int('LLM_RETRY_BASE_DELAY_MS', 1_000),
      logLevel: env.logLevel('info'),
    },
    agnes: {
      apiKey: agnesApiKey,
      baseURL: env.optional('AGNES_BASE_URL', 'https://apihub.agnes-ai.com/v1'),
      defaultModel: env.optional('AGNES_DEFAULT_MODEL', 'agnes-2.0-flash'),
    },
    qwen: {
      apiKey: qwenApiKey,
      baseURL: env.optional('QWEN_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
      defaultModel: env.optional('QWEN_DEFAULT_MODEL', 'qwen-max'),
    },
  };

  return cfg;
}

let cached: AppConfig | null = null;

/** 单例配置：首次调用加载，后续返回缓存 */
export function getConfig(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

/** 测试用：重置缓存，下次 getConfig() 重新加载 */
export function resetConfigCache(): void {
  cached = null;
}

export type {
  AppConfig,
  LlmRuntimeConfig,
  ProviderConfig,
  LlmProviderName,
  LogLevel,
} from './types';
