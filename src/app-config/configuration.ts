/**
 * NestJS 配置加载工厂（A1-W1）。
 *
 * registerAs('app') 注册为 ConfigService 的 'app' 命名空间。
 * 设计依据：A1 §四。
 */
import { registerAs } from '@nestjs/config';
import type { AppConfig } from './config.types';

export default registerAs('app', (): AppConfig => {
  const provider = (process.env.LLM_PROVIDER ?? 'agnes') as 'agnes' | 'qwen';

  // dev 环境允许 AGNES_API_KEY 缺失（仅 NestJS 骨架验证，不调 LLM）
  const agnesApiKey = process.env.AGNES_API_KEY ?? '';

  return {
    env: (process.env.NODE_ENV ?? 'dev') as AppConfig['env'],
    port: parseInt(process.env.PORT ?? '3000', 10),
    mongo: {
      uri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/legal-agent',
    },
    redis: {
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'legal:',
    },
    jwt: {
      secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-prod-32chars',
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
  };
});
