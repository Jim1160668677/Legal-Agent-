/**
 * NestJS 应用配置类型定义（A1-W1）。
 *
 * 覆盖：env/port/mongo/redis/jwt/llm/rateLimit。
 * 现有 src/config/types.ts 的 LlmRuntimeConfig 保留给 llm 层直连；
 * A1-W4 迁移时 LlmService 改为从 ConfigService 取值，两套合并。
 */

export interface AppConfig {
  env: 'dev' | 'staging' | 'prod';
  port: number;
  mongo: {
    uri: string;
  };
  redis: {
    url: string;
    keyPrefix: string;
  };
  jwt: {
    secret: string;
    expiresIn: string;
    refreshExpiresIn: string;
  };
  llm: {
    provider: 'agnes' | 'qwen';
    agnes: {
      apiKey: string;
      baseUrl: string;
      defaultModel: string;
    };
    timeoutMs: number;
    maxRetries: number;
    baseRetryDelayMs: number;
  };
  rateLimit: {
    perUserChatPerMin: number;
    perUserLlmPerDay: number;
    globalChatQps: number;
  };
  pii: {
    /** L4 字段加密密钥（>=32 字符）；缺失则由 jwt.secret 派生 */
    encryptionKey?: string;
  };
}

export type AppConfigRoot = Record<string, unknown>;
