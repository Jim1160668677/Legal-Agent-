/**
 * Zhipu 集成测试夹具（与 agnesFixture 同构）。
 *
 * 所有集成测试调用真实智谱 BigModel API（消耗少量 tokens）。
 * 通过 ZHIPU_API_KEY 是否存在 + 网络连通性预检决定是否跳过。
 */

import { getConfig, resetConfigCache } from '../../src/config';
import { createDefaultRegistry } from '../../src/services/legal/llm/registry';
import { LlmServiceImpl } from '../../src/services/legal/llm';
import type { LlmServiceImpl as Service } from '../../src/services/legal/llm';
import type { AppConfig } from '../../src/config/types';

/** 是否已配置 Zhipu API key（决定集成测试是否运行） */
export function hasZhipuKey(): boolean {
  const k = process.env.ZHIPU_API_KEY;
  return !!k && k.trim() !== '' && !k.startsWith('sk-xxx');
}

/** Zhipu API 连通性预检（带 globalThis 缓存）：任何 HTTP 响应都表示可达 */
export async function probeZhipuConnectivity(timeoutMs = 10_000): Promise<boolean> {
  const cacheKey = '__zhipuConnectivityProbe';
  const cached = (globalThis as Record<string, unknown>)[cacheKey];
  if (cached !== undefined) return cached as boolean;

  const baseURL = process.env.ZHIPU_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4';
  const probeURL = baseURL.replace(/\/v4\/?$/, '') + '/v4/models';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(probeURL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.ZHIPU_API_KEY ?? ''}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    // 任何 HTTP 响应（含 401/403/404）都说明服务器可达
    const reachable = resp.status > 0;
    (globalThis as Record<string, unknown>)[cacheKey] = reachable;
    if (!reachable) {
      console.warn(`[zhipuFixture] Zhipu API 连通性预检失败：HTTP ${resp.status}`);
    }
    return reachable;
  } catch (err) {
    (globalThis as Record<string, unknown>)[cacheKey] = false;
    console.warn(
      `[zhipuFixture] Zhipu API 连通性预检失败（网络不可达）：${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/** 一站式预检：API key 存在 && 网络可达 */
export async function ensureZhipuReady(): Promise<boolean> {
  if (!hasZhipuKey()) return false;
  return probeZhipuConnectivity();
}

/** 用真实配置创建 LlmService（zhipu active） */
export function createZhipuService(): Service {
  resetConfigCache();
  const cfg = getConfig();
  return new LlmServiceImpl(
    createDefaultRegistry({ ...cfg, llm: { ...cfg.llm, provider: 'zhipu' } }),
  );
}

/** 从当前配置派生一份可修改的副本 */
export function cloneConfig(): AppConfig {
  return structuredClone(getConfig());
}

/** 短 prompt（常规问答） */
export const SHORT_PROMPT = '用一句话解释什么是合同？';

/** 默认宽松调用选项（集成测试用） */
export const DEFAULT_OPTS = {
  maxRetries: 2,
  timeoutMs: 30_000,
};
