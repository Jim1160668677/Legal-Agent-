/**
 * NestJS 配置加载工厂（A1-W1）。
 *
 * registerAs('app') 注册为 ConfigService 的 'app' 命名空间。
 * 设计依据：A1 §四。
 */
import { registerAs } from '@nestjs/config';
import type { AppConfig } from './config.types';

export default registerAs('app', (): AppConfig => {
  const isLocal = (process.env.NODE_ENV ?? 'dev') === 'local';
  const provider = (process.env.LLM_PROVIDER ?? 'agnes') as 'agnes' | 'qwen' | 'zhipu';

  // dev 环境允许 AGNES_API_KEY 缺失（仅 NestJS 骨架验证，不调 LLM）
  const agnesApiKey = process.env.AGNES_API_KEY ?? '';
  const zhipuApiKey = process.env.ZHIPU_API_KEY ?? '';

  return {
    env: isLocal ? 'local' : (process.env.NODE_ENV ?? 'dev') as AppConfig['env'],
    port: parseInt(process.env.PORT ?? '3000', 10),
    mongo: {
      uri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/legal-agent',
    },
    redis: {
      url: isLocal ? '' : (process.env.REDIS_URL ?? 'redis://localhost:6379'),
      keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'legal:',
    },
    jwt: {
      secret: isLocal
        ? 'local-dev-secret-change-me'
        : (process.env.JWT_SECRET ?? generateRandomSecret()),
      expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
    },
    llm: {
      provider,
      agnes: {
        apiKey: agnesApiKey,
        baseUrl: process.env.AGNES_BASE_URL ?? 'https://apihub.agnes-ai.com/v1',
        defaultModel: process.env.AGNES_DEFAULT_MODEL ?? 'agnes-2.0-flash',
      },
      zhipu: {
        apiKey: zhipuApiKey,
        baseUrl: process.env.ZHIPU_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4',
        defaultModel: process.env.ZHIPU_DEFAULT_MODEL ?? 'glm-4.7-flash',
      },
      timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS ?? '30000', 10),
      maxRetries: parseInt(process.env.LLM_MAX_RETRIES ?? '3', 10),
      baseRetryDelayMs: parseInt(process.env.LLM_RETRY_BASE_DELAY_MS ?? '1000', 10),
    },
    rateLimit: {
      perUserChatPerMin: parseInt(process.env.RATE_PER_USER_CHAT_PER_MIN ?? '20', 10),
      perUserLlmPerDay: parseInt(process.env.RATE_PER_USER_LLM_PER_DAY ?? '50', 10),
      globalChatQps: parseInt(process.env.RATE_GLOBAL_CHAT_QPS ?? '500', 10),
    },
    pii: {
      encryptionKey: process.env.PII_ENCRYPTION_KEY,
    },
    embedding: {
      provider: (process.env.EMBEDDING_PROVIDER ?? 'mock') as 'mock' | 'agnes',
      apiKey: process.env.EMBEDDING_API_KEY ?? '',
      baseUrl: process.env.EMBEDDING_BASE_URL ?? 'https://apihub.agnes-ai.com/v1',
      model: process.env.EMBEDDING_MODEL ?? 'agnes-embedding-2.0',
      dimension: parseInt(process.env.EMBEDDING_DIMENSION ?? '1536', 10),
      batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE ?? '10', 10),
      cacheTtlSec: parseInt(process.env.EMBEDDING_CACHE_TTL_SEC ?? '2592000', 10), // 30 天
    },
    // Phase 2 A5 关键项：CORS / Swagger / Throttle
    cors: {
      origins: isLocal
        ? ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173']
        : (process.env.CORS_ORIGINS ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    },
    swagger: {
      enabled: (process.env.SWAGGER_ENABLED ?? 'true') === 'true',
      path: process.env.SWAGGER_PATH ?? '/docs',
    },
    throttle: {
      ttlMs: parseInt(process.env.THROTTLE_TTL_MS ?? '60000', 10),
      limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
      dailyLimit: parseInt(process.env.THROTTLE_DAILY_LIMIT ?? '10000', 10),
    },
    // v2.4：视觉模型（图像识别多模型主备切换）
    vision: {
      primaryModel: process.env.VISION_PRIMARY_MODEL ?? 'glm-4v-flash',
      fallbackModel: process.env.VISION_FALLBACK_MODEL ?? 'glm-4v-plus',
      timeoutMs: parseInt(process.env.VISION_TIMEOUT_MS ?? '30000', 10),
      maxRetries: parseInt(process.env.VISION_MAX_RETRIES ?? '2', 10),
      cooldownMs: parseInt(process.env.VISION_COOLDOWN_MS ?? '30000', 10),
    },
  };
});

/** 生成随机 JWT 密钥（≥32 字符） */
function generateRandomSecret(): string {
  const { randomBytes } = require('crypto') as typeof import('crypto');
  return randomBytes(32).toString('hex');
}
