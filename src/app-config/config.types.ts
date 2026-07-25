/**
 * NestJS 应用配置类型定义（A1-W1 + A2-W2 扩展）。
 *
 * 覆盖：env/port/mongo/redis/jwt/llm/rateLimit/pii/embedding。
 * 现有 src/config/types.ts 的 LlmRuntimeConfig 保留给 llm 层直连；
 * A1-W4 迁移时 LlmService 改为从 ConfigService 取值，两套合并。
 *
 * A2-W2：新增 embedding 段（provider/apiKey/baseUrl/model/dimension/batchSize/cacheTtlSec）。
 */
import type { EmbeddingConfig } from '../modules/legal/embedding/embedding.types';

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
  /** A2-W2：Embedding 向量化配置（mock 默认；agnes 需 EMBEDDING_API_KEY） */
  embedding: EmbeddingConfig;
}

export type AppConfigRoot = Record<string, unknown>;
