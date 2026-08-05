/**
 * src/config/env.ts 单元测试（环境变量读取与校验工具）。
 *
 * 覆盖：
 *   - required：命中/fallback/缺失空串抛错/trim
 *   - optional：命中/空串回退 fallback
 *   - int：缺失回退/非法抛错（0、负数、小数、非数字）
 *   - oneOf：命中/非法抛错
 *   - logLevel / providerName 枚举快捷方法
 *
 * 设计依据：A1 §四 配置管理。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from '../../src/config/env';

const SAVED_ENV: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k !== 'NODE_ENV') SAVED_ENV[k] = process.env[k];
  }
});

afterEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('env', () => {
  it('required：命中 + trim', () => {
    process.env.FOO = '  abc  ';
    expect(env.required('FOO')).toBe('abc');
  });

  it('required：缺失但有 fallback → fallback', () => {
    expect(env.required('NOPE', 'fb')).toBe('fb');
  });

  it('required：缺失/空串无 fallback → 抛错', () => {
    expect(() => env.required('NOPE')).toThrow('Missing required env var: NOPE');
    process.env.EMPTY = '   ';
    expect(() => env.required('EMPTY')).toThrow();
  });

  it('optional：命中/缺失/空串', () => {
    process.env.BAR = '  x  ';
    expect(env.optional('BAR', 'd')).toBe('x');
    expect(env.optional('NOPE', 'd')).toBe('d');
    process.env.BLANK = '';
    expect(env.optional('BLANK', 'd')).toBe('d');
  });

  it('int：缺失回退 / 合法值', () => {
    expect(env.int('NOPE', 5)).toBe(5);
    process.env.N = '42';
    expect(env.int('N', 5)).toBe(42);
  });

  it('int：非法值抛错', () => {
    process.env.ZERO = '0';
    expect(() => env.int('ZERO', 5)).toThrow('Invalid int');
    process.env.NEG = '-3';
    expect(() => env.int('NEG', 5)).toThrow();
    process.env.DEC = '1.5';
    expect(() => env.int('DEC', 5)).toThrow();
    process.env.STR = 'abc';
    expect(() => env.int('STR', 5)).toThrow();
  });

  it('oneOf：命中 / 非法抛错', () => {
    process.env.COLOR = 'red';
    expect(env.oneOf('COLOR', ['red', 'blue'] as const, 'blue')).toBe('red');
    expect(env.oneOf('NOPE', ['red', 'blue'] as const, 'blue')).toBe('blue');
    process.env.BAD = 'green';
    expect(() => env.oneOf('BAD', ['red', 'blue'] as const, 'blue')).toThrow(
      'must be one of [red|blue]',
    );
  });

  it('logLevel / providerName 枚举', () => {
    expect(env.logLevel()).toBe('info');
    process.env.LLM_LOG_LEVEL = 'debug';
    expect(env.logLevel()).toBe('debug');
    expect(env.providerName()).toBe('agnes');
    process.env.LLM_PROVIDER = 'zhipu';
    expect(env.providerName()).toBe('zhipu');
    process.env.LLM_PROVIDER = 'nope';
    expect(() => env.providerName()).toThrow();
  });
});