import type { LogLevel, LlmProviderName } from './types';

/**
 * 环境变量读取与校验工具。
 * 所有方法直接读 process.env，不缓存，便于测试时覆盖。
 */
export const env = {
  /** 必填字符串，缺失抛错；可给 fallback */
  required(name: string, fallback?: string): string {
    const v = process.env[name] ?? fallback;
    if (!v || v.trim() === '') {
      throw new Error(`Missing required env var: ${name}`);
    }
    return v.trim();
  },

  /** 可选字符串，缺失返回 fallback */
  optional(name: string, fallback: string): string {
    const v = process.env[name];
    return v && v.trim() !== '' ? v.trim() : fallback;
  },

  /** 正整数，缺失或非法抛错 */
  int(name: string, fallback: number): number {
    const v = process.env[name];
    if (v === undefined || v === '') return fallback;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      throw new Error(`Invalid int for ${name}: ${v}`);
    }
    return n;
  },

  /** 枚举校验 */
  oneOf<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
    const v = (process.env[name] ?? fallback) as T;
    if (!allowed.includes(v)) {
      throw new Error(`${name} must be one of [${allowed.join('|')}], got: ${v}`);
    }
    return v;
  },

  /** LogLevel 枚举 */
  logLevel(fallback: LogLevel = 'info'): LogLevel {
    return env.oneOf<LogLevel>(
      'LLM_LOG_LEVEL',
      ['debug', 'info', 'warn', 'error'] as const,
      fallback,
    );
  },

  /** LlmProviderName 枚举 */
  providerName(fallback: LlmProviderName = 'agnes'): LlmProviderName {
    return env.oneOf<LlmProviderName>('LLM_PROVIDER', ['agnes', 'qwen'] as const, fallback);
  },
};
