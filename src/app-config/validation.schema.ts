/**
 * Joi 配置校验 schema（A1-W1）。
 *
 * 启动时校验环境变量，缺失/非法则启动失败（fail-fast）。
 * 设计依据：A1 §四 配置管理。
 */
import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('dev', 'staging', 'prod').default('dev'),
  PORT: Joi.number().port().default(3000),

  // MongoDB
  MONGO_URI: Joi.string().required().description('MongoDB 连接字符串'),

  // Redis
  REDIS_URL: Joi.string().required().description('Redis 连接字符串'),
  REDIS_KEY_PREFIX: Joi.string().default('legal:'),

  // JWT（强制 ≥32 字符，杜绝弱密钥；与 PII 派生链路同源风险隔离）
  JWT_SECRET: Joi.string().min(32).required().description('JWT 签名密钥（≥32 字符）'),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),

  // LLM
  LLM_PROVIDER: Joi.string().valid('agnes', 'qwen', 'zhipu').default('agnes'),
  AGNES_API_KEY: Joi.string().allow('').default(''),
  AGNES_BASE_URL: Joi.string().default('https://apihub.agnes-ai.com/v1'),
  AGNES_DEFAULT_MODEL: Joi.string().default('agnes-2.0-flash'),
  ZHIPU_API_KEY: Joi.string().allow('').default(''),
  ZHIPU_BASE_URL: Joi.string().default('https://open.bigmodel.cn/api/paas/v4'),
  ZHIPU_DEFAULT_MODEL: Joi.string().default('glm-4.7-flash'),
  LLM_TIMEOUT_MS: Joi.number().default(30000),
  LLM_MAX_RETRIES: Joi.number().default(3),
  LLM_RETRY_BASE_DELAY_MS: Joi.number().default(1000),

  // 限流
  RATE_PER_USER_CHAT_PER_MIN: Joi.number().default(20),
  RATE_PER_USER_LLM_PER_DAY: Joi.number().default(50),
  RATE_GLOBAL_CHAT_QPS: Joi.number().default(500),

  // PII 加密（可选；缺失则由 JWT_SECRET 派生）
  PII_ENCRYPTION_KEY: Joi.string().allow('').default(''),

  // Embedding 向量化（A2-W2；默认 mock 无外部依赖）
  EMBEDDING_PROVIDER: Joi.string().valid('mock', 'agnes').default('mock'),
  EMBEDDING_API_KEY: Joi.string().allow('').default(''),
  EMBEDDING_BASE_URL: Joi.string().default('https://apihub.agnes-ai.com/v1'),
  EMBEDDING_MODEL: Joi.string().default('agnes-embedding-2.0'),
  EMBEDDING_DIMENSION: Joi.number().integer().min(64).max(4096).default(1536),
  EMBEDDING_BATCH_SIZE: Joi.number().integer().min(1).max(100).default(10),
  EMBEDDING_CACHE_TTL_SEC: Joi.number().integer().min(0).default(2592000),

  // 日志级别
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace').default('info'),

  // Phase 2 A5 关键项：CORS / Swagger / Throttle
  CORS_ORIGINS: Joi.string().allow('').default('').description('逗号分隔的允许源，空=允许所有'),
  SWAGGER_ENABLED: Joi.string().valid('true', 'false').default('true'),
  SWAGGER_PATH: Joi.string().default('/docs'),
  THROTTLE_TTL_MS: Joi.number().integer().min(1000).default(60_000),
  THROTTLE_LIMIT: Joi.number().integer().min(1).default(100),
  THROTTLE_DAILY_LIMIT: Joi.number().integer().min(1).default(10_000),

  // v2.4：视觉模型（图像识别多模型主备切换）
  VISION_PRIMARY_MODEL: Joi.string().default('glm-4v-flash'),
  VISION_FALLBACK_MODEL: Joi.string().default('glm-4v-plus'),
  VISION_TIMEOUT_MS: Joi.number().integer().min(1000).default(30_000),
  VISION_MAX_RETRIES: Joi.number().integer().min(0).default(2),
  VISION_COOLDOWN_MS: Joi.number().integer().min(1000).default(30_000),
});
