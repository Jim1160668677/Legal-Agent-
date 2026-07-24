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

  // JWT
  JWT_SECRET: Joi.string().min(16).required().description('JWT 签名密钥'),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),

  // LLM
  LLM_PROVIDER: Joi.string().valid('agnes', 'qwen').default('agnes'),
  AGNES_API_KEY: Joi.string().allow('').default(''),
  AGNES_BASE_URL: Joi.string().default('https://apihub.agnes-ai.com/v1'),
  AGNES_DEFAULT_MODEL: Joi.string().default('agnes-2.0-flash'),
  LLM_TIMEOUT_MS: Joi.number().default(30000),
  LLM_MAX_RETRIES: Joi.number().default(3),
  LLM_RETRY_BASE_DELAY_MS: Joi.number().default(1000),

  // 限流
  RATE_PER_USER_CHAT_PER_MIN: Joi.number().default(20),
  RATE_PER_USER_LLM_PER_DAY: Joi.number().default(50),
  RATE_GLOBAL_CHAT_QPS: Joi.number().default(500),

  // PII 加密（可选；缺失则由 JWT_SECRET 派生）
  PII_ENCRYPTION_KEY: Joi.string().allow('').default(''),

  // 日志级别
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace').default('info'),
});
