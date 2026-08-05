/**
 * app-config（configuration + validation.schema）单元测试（A1-W1）。
 *
 * 覆盖：
 *   - registerAs('app') 工厂：默认值 / env 覆盖 / CORS 拆分 / SWAGGER 布尔化
 *   - Joi validationSchema：缺 MONGO_URI 拒绝；弱 JWT_SECRET 拒绝；合法 env 通过 + 默认补齐
 *
 * 设计依据：A1 §四 配置管理（fail-fast）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import configurationFactory from '../../src/app-config/configuration';
import { validationSchema } from '../../src/app-config/validation.schema';

const SAVED_ENV: Record<string, string | undefined> = {};

afterEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('configuration（registerAs app 工厂）', () => {
  it('空 env → 全部默认值', () => {
    delete process.env.NODE_ENV;
    process.env.JWT_SECRET = 'x'.repeat(32);
    process.env.MONGO_URI = 'mongodb://m:27017/test';
    process.env.REDIS_URL = 'redis://r:6379';
    const cfg = configurationFactory() as {
      env: string;
      port: number;
      llm: { provider: string; agnes: { baseUrl: string } };
      embedding: { provider: string; dimension: number };
      cors: { origins: string[] };
      swagger: { enabled: boolean; path: string };
      vision: { primaryModel: string };
    };
    expect(cfg.env).toBe('dev');
    expect(cfg.port).toBe(3000);
    expect(cfg.llm.provider).toBe('agnes');
    expect(cfg.llm.agnes.baseUrl).toBe('https://apihub.agnes-ai.com/v1');
    expect(cfg.embedding.provider).toBe('mock');
    expect(cfg.embedding.dimension).toBe(1536);
    expect(cfg.cors.origins).toEqual([]);
    expect(cfg.swagger).toEqual({ enabled: true, path: '/docs' });
    expect(cfg.vision.primaryModel).toBe('glm-4v-flash');
  });

  it('env 覆盖生效 + CORS 逗号拆分 + SWAGGER_ENABLED=false', () => {
    process.env.JWT_SECRET = 'y'.repeat(32);
    process.env.NODE_ENV = 'prod';
    process.env.PORT = '8080';
    process.env.LLM_PROVIDER = 'zhipu';
    process.env.AGNES_BASE_URL = 'https://custom/v1';
    process.env.CORS_ORIGINS = ' https://a.com , https://b.com , ';
    process.env.SWAGGER_ENABLED = 'false';
    process.env.LOG_LEVEL = 'warn';

    const cfg = configurationFactory() as {
      env: string;
      port: number;
      llm: { provider: string; agnes: { baseUrl: string } };
      cors: { origins: string[] };
      swagger: { enabled: boolean };
    };
    expect(cfg.env).toBe('prod');
    expect(cfg.port).toBe(8080);
    expect(cfg.llm.provider).toBe('zhipu');
    expect(cfg.llm.agnes.baseUrl).toBe('https://custom/v1');
    expect(cfg.cors.origins).toEqual(['https://a.com', 'https://b.com']);
    expect(cfg.swagger.enabled).toBe(false);
  });
});

describe('validationSchema（Joi fail-fast）', () => {
  const validEnv = {
    MONGO_URI: 'mongodb://localhost:27017/legal-agent',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'x'.repeat(32),
  };

  it('合法 env → 通过 + 注入默认值', () => {
    const { error, value } = validationSchema.validate({ ...validEnv }, { allowUnknown: true });
    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('dev');
    expect(value.PORT).toBe(3000);
    expect(value.EMBEDDING_PROVIDER).toBe('mock');
    expect(value.VISION_PRIMARY_MODEL).toBe('glm-4v-flash');
  });

  it('缺 MONGO_URI → 拒绝', () => {
    const { error } = validationSchema.validate(
      { REDIS_URL: 'r', JWT_SECRET: 'x'.repeat(32) },
      { allowUnknown: true },
    );
    expect(error).toBeDefined();
    expect(String(error!.message)).toContain('MONGO_URI');
  });

  it('JWT_SECRET 不足 32 字符 → 拒绝（弱密钥）', () => {
    const { error } = validationSchema.validate(
      { ...validEnv, JWT_SECRET: 'short' },
      { allowUnknown: true },
    );
    expect(error).toBeDefined();
    expect(String(error!.message)).toContain('JWT_SECRET');
  });

  it('非法 LLM_PROVIDER → 拒绝', () => {
    const { error } = validationSchema.validate(
      { ...validEnv, LLM_PROVIDER: 'deepseek' },
      { allowUnknown: true },
    );
    expect(error).toBeDefined();
  });
});