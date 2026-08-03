/**
 * Agnes 集成测试夹具。
 *
 * 所有集成测试调用真实 Agnes API（消耗少量 tokens）。
 * 通过 AGNES_API_KEY 是否存在 + 网络连通性预检决定是否跳过；测试默认使用宽松超时。
 */

import { getConfig, resetConfigCache } from '../../src/config';
import { createDefaultRegistry } from '../../src/services/legal/llm/registry';
import { LlmServiceImpl } from '../../src/services/legal/llm';
import type { LlmServiceImpl as Service } from '../../src/services/legal/llm';
import type { AppConfig } from '../../src/config/types';

/** 是否已配置 Agnes API key（决定集成测试是否运行） */
export function hasAgnesKey(): boolean {
  const k = process.env.AGNES_API_KEY;
  return !!k && !k.startsWith('sk-xxx') && k.trim() !== '';
}

/**
 * Agnes API 连通性预检（带 globalThis 缓存）。
 *
 * 向 Agnes API /v1/models 发送 GET 请求，任何 HTTP 响应（包括 401）都表示服务器可达。
 * 超时或 DNS 解析失败返回 false，集成测试将整体跳过而非逐个超时失败。
 *
 * 缓存策略：结果写入 globalThis，跨测试文件共享（vitest fileParallelism=false 同进程顺序执行）。
 * 首次调用耗时 < 5s，后续调用 O(1)。
 *
 * 修复背景：DNS 异常时 apihub.agnes-ai.com 被解析到错误 IP（如 Twitter IP），
 * 导致 21 个集成测试逐个等待 10s 连接超时后才失败。预检 + skip 避免浪费时间。
 */
export async function probeAgnesConnectivity(timeoutMs = 5_000): Promise<boolean> {
  const cacheKey = '__agnesConnectivityProbe';
  const cached = (globalThis as Record<string, unknown>)[cacheKey];
  if (cached !== undefined) return cached as boolean;

  const baseURL = process.env.AGNES_BASE_URL ?? 'https://apihub.agnes-ai.com/v1';
  const probeURL = baseURL.replace(/\/v1\/?$/, '') + '/v1/models';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(probeURL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.AGNES_API_KEY ?? ''}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    // 任何 HTTP 响应（含 401/403）都说明服务器可达
    const reachable = resp.status > 0;
    (globalThis as Record<string, unknown>)[cacheKey] = reachable;
    if (!reachable) {
      console.warn(`[agnesFixture] Agnes API 连通性预检失败：HTTP ${resp.status}`);
    }
    return reachable;
  } catch (err) {
    (globalThis as Record<string, unknown>)[cacheKey] = false;
    console.warn(
      `[agnesFixture] Agnes API 连通性预检失败（网络不可达）：${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * 一站式预检：API key 存在 && 网络可达。
 * 供集成测试文件 top-level await 调用，配合 describe.skipIf 使用。
 *
 * @example
 * const agnesReady = await ensureAgnesReady();
 * describe.skipIf(!agnesReady)('Agnes 集成测试', () => { ... });
 */
export async function ensureAgnesReady(): Promise<boolean> {
  if (!hasAgnesKey()) return false;
  return probeAgnesConnectivity();
}

/** 用真实配置创建 LlmService（agnes active） */
export function createAgnesService(): Service {
  resetConfigCache();
  const cfg = getConfig();
  // agnes 测试夹具强制 agnes provider（.env 可能 LLM_PROVIDER=zhipu，但 registry 仅注册 agnes+qwen）
  return new LlmServiceImpl(
    createDefaultRegistry({ ...cfg, llm: { ...cfg.llm, provider: 'agnes' } }),
  );
}

/** 用自定义 cfg 创建 LlmService（用于错误场景测试） */
export function createServiceWithConfig(cfg: AppConfig): Service {
  // 同上：强制 agnes provider，避免 .env 的 zhipu 导致 createDefaultRegistry 注册失败
  return new LlmServiceImpl(
    createDefaultRegistry({ ...cfg, llm: { ...cfg.llm, provider: 'agnes' } }),
  );
}

/** 从当前配置派生一份可修改的副本 */
export function cloneConfig(): AppConfig {
  return structuredClone(getConfig());
}

/** 短 prompt（常规问答） */
export const SHORT_PROMPT = '用一句话解释什么是合同。';

/** 长 prompt（~2000 字法律场景，用于长文本/性能测试） */
export const LONG_PROMPT = [
  '请阅读以下案件事实并分析其中涉及的法律关系：',
  '2024年3月，甲公司与乙公司签订了一份设备买卖合同，合同约定甲公司向乙公司购买一台价值50万元的生产设备，',
  '交货期为2024年5月1日，付款方式为货到验收合格后10日内一次性付清。合同还约定，任何一方违约应向守约方支付',
  '合同总价款20%的违约金。合同签订后，甲公司依约于2024年4月15日支付了5万元定金。然而到了交货期，乙公司',
  '以原材料价格上涨为由要求提高设备价格，否则拒绝交货。经多次协商未果，甲公司于2024年5月20日书面通知乙公司',
  '解除合同，并要求乙公司双倍返还定金、支付违约金。乙公司回复称，定金只能单倍返还，违约金过高应予调整。',
  '甲公司遂诉至法院。请分析：1.乙公司不交货是否构成违约；2.甲公司主张解除合同是否有法律依据；',
  '3.定金罚则如何适用；4.违约金是否可以调整；5.本案应适用《民法典》哪些条文。',
  '请给出详细的法律分析意见。',
].join('');

/** 连通性校验：generate "pong" 应返回包含 pong 的内容 */
export async function awaitPong(service: Service): Promise<string> {
  const r = await service.generate('Reply with exactly pong.', {
    maxTokens: 8,
    maxRetries: 0,
    timeoutMs: 15_000,
  });
  return r.content;
}

/** 默认宽松调用选项（集成测试用）。
 *  maxRetries: 3 — 真实 API 可能瞬态 429 限流，启用重试（429 可重试，指数退避）。
 *  exception 测试需确定性失败时显式覆盖 maxRetries: 0。 */
export const DEFAULT_OPTS = {
  maxRetries: 3,
  timeoutMs: 30_000,
};
