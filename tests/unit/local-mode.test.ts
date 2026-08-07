/**
 * local 模式单元测试（Task 1）。
 *
 * 覆盖：
 *   - validation.schema：NODE_ENV=local 时 REDIS_URL 可为空，JWT_SECRET 可不填
 *   - configuration：local 模式下 redis.url 为空，jwt.secret 为固定值，cors.origins 包含 localhost
 *   - JwtStrategy：local 模式下不抛错，validate 返回默认用户
 *   - auth.types：JwtPayload 包含 env 字段
 *
 * 设计依据：Task 1 本地模式支持。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Joi from 'joi';
import { JwtStrategy } from '../../src/modules/auth/jwt.strategy';
import { validationSchema } from '../../src/app-config/validation.schema';
import configurationFactory from '../../src/app-config/configuration';
import type { JwtPayload } from '../../src/modules/auth/auth.types';

/** 保存并恢复 NODE_ENV，避免污染其他测试 */
const SAVED_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  process.env.NODE_ENV = 'local';
  process.env.MONGO_URI = 'mongodb://localhost:27017/legal-agent';
});

afterEach(() => {
  if (SAVED_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = SAVED_NODE_ENV;
  }
  delete process.env.MONGO_URI;
  delete process.env.REDIS_URL;
  delete process.env.JWT_SECRET;
});

describe('validationSchema: local mode', () => {
  it('NODE_ENV=local 且无 JWT_SECRET 和 REDIS_URL 时通过校验', () => {
    const { error, value } = validationSchema.validate({
      NODE_ENV: 'local',
      MONGO_URI: 'mongodb://localhost:27017/legal-agent',
    });
    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('local');
    expect(value.JWT_SECRET).toBe('local-dev-secret-change-me');
    expect(value.REDIS_URL).toBe('');
  });

  it('NODE_ENV=prod 且无 JWT_SECRET 时校验失败', () => {
    const { error } = validationSchema.validate({
      NODE_ENV: 'prod',
      MONGO_URI: 'mongodb://localhost:27017/legal-agent',
    });
    expect(error).toBeDefined();
  });
});

describe('configuration: local mode', () => {
  it('local 模式下 redis.url 为空，jwt.secret 为固定值，cors.origins 含 localhost', () => {
    delete process.env.REDIS_URL;
    delete process.env.JWT_SECRET;
    const cfg = configurationFactory();
    expect(cfg.env).toBe('local');
    expect(cfg.redis.url).toBe('');
    expect(cfg.jwt.secret).toBe('local-dev-secret-change-me');
    expect(cfg.cors.origins).toContain('http://localhost:3000');
    expect(cfg.cors.origins).toContain('http://127.0.0.1:3000');
    expect(cfg.cors.origins).toContain('http://localhost:5173');
  });
});

describe('JwtStrategy: local mode', () => {
  it('local 模式下构造不抛错', () => {
    const makeConfig = (secret: string) =>
      ({
        get: (key: string) => {
          if (key === 'app.env') return 'local';
          if (key === 'app.jwt.secret') return secret;
          return undefined;
        },
      }) as never;

    expect(() => new JwtStrategy(makeConfig('local-dev-secret-change-me'))).not.toThrow();
  });

  it('local 模式下 validate 返回默认用户', async () => {
    const makeConfig = (secret: string) =>
      ({
        get: (key: string) => {
          if (key === 'app.env') return 'local';
          if (key === 'app.jwt.secret') return secret;
          return undefined;
        },
      }) as never;

    const strat = new JwtStrategy(makeConfig('local-dev-secret-change-me'));
    const payload: JwtPayload = { sub: 'any', type: 'access', env: 'local' };
    const result = await strat.validate(payload);
    expect(result.sub).toBe('local-user');
    expect(result.role).toBe('user');
  });

  it('非 local 模式下 validate 正常行为不变', async () => {
    const makeConfig = (secret: string) =>
      ({
        get: (key: string) => {
          if (key === 'app.env') return 'dev';
          if (key === 'app.jwt.secret') return secret;
          return undefined;
        },
      }) as never;

    const strat = new JwtStrategy(makeConfig('s'.repeat(32)));
    const payload = { sub: 'u1', type: 'access' as const };
    await expect(strat.validate(payload)).resolves.toBe(payload);
  });

  it('非 local 模式下 type=refresh 仍抛 Unauthorized', async () => {
    const makeConfig = (secret: string) =>
      ({
        get: (key: string) => {
          if (key === 'app.env') return 'dev';
          if (key === 'app.jwt.secret') return secret;
          return undefined;
        },
      }) as never;

    const strat = new JwtStrategy(makeConfig('s'.repeat(32)));
    const payload = { sub: 'u1', type: 'refresh' as const };
    await expect(strat.validate(payload)).rejects.toThrow();
  });
});
