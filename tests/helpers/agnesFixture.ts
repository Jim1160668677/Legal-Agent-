/**
 * Agnes 集成测试夹具。
 *
 * 所有集成测试调用真实 Agnes API（消耗少量 tokens）。
 * 通过 AGNES_API_KEY 是否存在决定是否跳过；测试默认使用宽松超时。
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

/** 用真实配置创建 LlmService（agnes active） */
export function createAgnesService(): Service {
  resetConfigCache();
  return new LlmServiceImpl(createDefaultRegistry(getConfig()));
}

/** 用自定义 cfg 创建 LlmService（用于错误场景测试） */
export function createServiceWithConfig(cfg: AppConfig): Service {
  return new LlmServiceImpl(createDefaultRegistry(cfg));
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
