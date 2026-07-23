import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, getConfig, resetConfigCache } from '../../src/config';
import type { AppConfig } from '../../src/config/types';

/**
 * config 层单测。
 *
 * 通过临时修改 process.env 验证 loadConfig/getConfig/resetConfigCache 行为，
 * 不依赖网络。每个用例前后保存/恢复 env，避免污染其他用例。
 */

const ENV_KEYS = [
  'LLM_PROVIDER',
  'AGNES_API_KEY',
  'AGNES_BASE_URL',
  'AGNES_DEFAULT_MODEL',
  'QWEN_API_KEY',
  'QWEN_BASE_URL',
  'QWEN_DEFAULT_MODEL',
  'LLM_TIMEOUT_MS',
  'LLM_MAX_RETRIES',
  'LLM_RETRY_BASE_DELAY_MS',
  'LLM_LOG_LEVEL',
] as const;

let snapshot: Record<string, string | undefined> = {};

function snapshotEnv(): void {
  snapshot = {};
  for (const k of ENV_KEYS) snapshot[k] = process.env[k];
}

function restoreEnv(): void {
  for (const k of ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
}

/** 设一套合法 agnes 配置 */
function setValidAgnesEnv(): void {
  process.env.LLM_PROVIDER = 'agnes';
  process.env.AGNES_API_KEY = 'sk-test-valid-key-1234';
  process.env.AGNES_BASE_URL = 'https://apihub.agnes-ai.com/v1';
  process.env.AGNES_DEFAULT_MODEL = 'agnes-2.0-flash';
  delete process.env.LLM_TIMEOUT_MS;
  delete process.env.LLM_MAX_RETRIES;
  delete process.env.LLM_RETRY_BASE_DELAY_MS;
  delete process.env.LLM_LOG_LEVEL;
}

describe('config', () => {
  beforeEach(() => {
    snapshotEnv();
    resetConfigCache();
  });

  afterEach(() => {
    restoreEnv();
    resetConfigCache();
  });

  describe('loadConfig', () => {
    it('合法 agnes 配置加载并返回正确 AppConfig', () => {
      setValidAgnesEnv();
      const cfg = loadConfig();
      expect(cfg.llm.provider).toBe('agnes');
      expect(cfg.agnes.apiKey).toBe('sk-test-valid-key-1234');
      expect(cfg.agnes.baseURL).toBe('https://apihub.agnes-ai.com/v1');
      expect(cfg.agnes.defaultModel).toBe('agnes-2.0-flash');
    });

    it('应用默认值（timeoutMs/maxRetries/baseRetryDelayMs/logLevel）', () => {
      setValidAgnesEnv();
      const cfg = loadConfig();
      expect(cfg.llm.timeoutMs).toBe(30_000);
      expect(cfg.llm.maxRetries).toBe(3);
      expect(cfg.llm.baseRetryDelayMs).toBe(1_000);
      expect(cfg.llm.logLevel).toBe('info');
    });

    it('qwen 段默认值正确', () => {
      setValidAgnesEnv();
      delete process.env.QWEN_BASE_URL;
      delete process.env.QWEN_DEFAULT_MODEL;
      const cfg = loadConfig();
      expect(cfg.qwen.baseURL).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
      expect(cfg.qwen.defaultModel).toBe('qwen-max');
    });

    it('LLM_PROVIDER=agnes 且 AGNES_API_KEY 缺失时抛错', () => {
      process.env.LLM_PROVIDER = 'agnes';
      delete process.env.AGNES_API_KEY;
      expect(() => loadConfig()).toThrow(/AGNES_API_KEY is required/);
    });

    it('LLM_PROVIDER=agnes 且 AGNES_API_KEY 为占位符 sk-xxx 时抛错', () => {
      process.env.LLM_PROVIDER = 'agnes';
      process.env.AGNES_API_KEY = 'sk-xxx';
      expect(() => loadConfig()).toThrow(/AGNES_API_KEY is required/);
    });

    it('LLM_PROVIDER=agnes 且 AGNES_API_KEY 为空字符串时抛错', () => {
      process.env.LLM_PROVIDER = 'agnes';
      process.env.AGNES_API_KEY = '';
      expect(() => loadConfig()).toThrow(/AGNES_API_KEY is required/);
    });

    it('LLM_PROVIDER=qwen 且 QWEN_API_KEY 缺失时抛错', () => {
      process.env.LLM_PROVIDER = 'qwen';
      delete process.env.QWEN_API_KEY;
      expect(() => loadConfig()).toThrow(/QWEN_API_KEY is required/);
    });

    it('LLM_PROVIDER=qwen 且 QWEN_API_KEY 存在时正常加载', () => {
      process.env.LLM_PROVIDER = 'qwen';
      process.env.QWEN_API_KEY = 'sk-qwen-test';
      delete process.env.AGNES_API_KEY;
      const cfg = loadConfig();
      expect(cfg.llm.provider).toBe('qwen');
      expect(cfg.qwen.apiKey).toBe('sk-qwen-test');
    });

    it('自定义 LLM_TIMEOUT_MS / LLM_MAX_RETRIES / LLM_RETRY_BASE_DELAY_MS 生效', () => {
      setValidAgnesEnv();
      process.env.LLM_TIMEOUT_MS = '12000';
      process.env.LLM_MAX_RETRIES = '5';
      process.env.LLM_RETRY_BASE_DELAY_MS = '500';
      const cfg = loadConfig();
      expect(cfg.llm.timeoutMs).toBe(12_000);
      expect(cfg.llm.maxRetries).toBe(5);
      expect(cfg.llm.baseRetryDelayMs).toBe(500);
    });

    it('LLM_LOG_LEVEL 自定义值生效', () => {
      setValidAgnesEnv();
      process.env.LLM_LOG_LEVEL = 'debug';
      expect(loadConfig().llm.logLevel).toBe('debug');
    });

    it('非法 LLM_LOG_LEVEL 抛错', () => {
      setValidAgnesEnv();
      process.env.LLM_LOG_LEVEL = 'verbose';
      expect(() => loadConfig()).toThrow(/LLM_LOG_LEVEL must be one of/);
    });

    it('非法 LLM_TIMEOUT_MS（非正整数）抛错', () => {
      setValidAgnesEnv();
      process.env.LLM_TIMEOUT_MS = '0';
      expect(() => loadConfig()).toThrow(/Invalid int for LLM_TIMEOUT_MS/);
    });

    it('自定义 AGNES_BASE_URL / AGNES_DEFAULT_MODEL 生效', () => {
      setValidAgnesEnv();
      process.env.AGNES_BASE_URL = 'https://custom.example.com/v1';
      process.env.AGNES_DEFAULT_MODEL = 'agnes-custom';
      const cfg = loadConfig();
      expect(cfg.agnes.baseURL).toBe('https://custom.example.com/v1');
      expect(cfg.agnes.defaultModel).toBe('agnes-custom');
    });
  });

  describe('getConfig / resetConfigCache', () => {
    it('getConfig 首次加载后缓存（同一引用）', () => {
      setValidAgnesEnv();
      const a = getConfig();
      const b = getConfig();
      expect(a).toBe(b); // 同一引用，缓存命中
    });

    it('resetConfigCache 后重新加载（不同引用）', () => {
      setValidAgnesEnv();
      const a = getConfig();
      resetConfigCache();
      const b = getConfig();
      expect(a).not.toBe(b); // 重新加载，新对象
      expect(b.llm.provider).toBe('agnes');
    });

    it('resetConfigCache 后修改 env 再 getConfig 反映新值', () => {
      setValidAgnesEnv();
      const a = getConfig();
      expect(a.agnes.apiKey).toBe('sk-test-valid-key-1234');
      resetConfigCache();
      process.env.AGNES_API_KEY = 'sk-changed-key-5678';
      const b = getConfig();
      expect(b.agnes.apiKey).toBe('sk-changed-key-5678');
    });
  });

  describe('类型导出', () => {
    it('AppConfig 结构完整（llm/agnes/qwen 三段）', () => {
      setValidAgnesEnv();
      const cfg: AppConfig = loadConfig();
      expect(cfg).toHaveProperty('llm');
      expect(cfg).toHaveProperty('agnes');
      expect(cfg).toHaveProperty('qwen');
      expect(cfg.llm).toHaveProperty('provider');
      expect(cfg.llm).toHaveProperty('timeoutMs');
      expect(cfg.agnes).toHaveProperty('apiKey');
      expect(cfg.agnes).toHaveProperty('baseURL');
      expect(cfg.agnes).toHaveProperty('defaultModel');
    });
  });
});
