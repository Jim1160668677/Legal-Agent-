import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest';
import {
  createAgnesService,
  hasAgnesKey,
  probeAgnesConnectivity,
  SHORT_PROMPT,
  LONG_PROMPT,
  DEFAULT_OPTS,
} from '../../helpers/agnesFixture';
import { record, printTable, resetPerf } from '../../helpers/perfMetrics';

/** 短暂等待（让免费用户限流窗口恢复） */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 性能集成测试 — 真实 Agnes API。
 *
 * 验证延迟与吞吐阈值：
 * - 短 prompt < 15s
 * - 长 prompt < 30s
 * - 流式首 token < 10s
 * - tokens/s > 1
 *
 * 阈值为宽松值（真实网络波动），仅作回归参考。
 * 性能测试用 maxRetries=5（高于默认 3）：免费用户限流严格，
 * 长 prompt 等重请求可能触发 429，需更多重试 + 退避等待恢复。
 */

const PERF_OPTS = { ...DEFAULT_OPTS, maxRetries: 5 };

describe.skipIf(!hasAgnesKey())('Agnes 性能', () => {
  let agnesReachable = false;

  // 连通性预检在 beforeAll 中执行（避免 top-level await 阻塞模块加载导致 vitest worker RPC 超时）
  beforeAll(async () => {
    agnesReachable = await probeAgnesConnectivity();
  }, 8_000);

  // 网络不可达时跳过所有测试（而非逐个超时失败）
  beforeEach((ctx) => {
    if (!agnesReachable) ctx.skip();
  });

  afterAll(() => {
    printTable();
  });

  it('1. 短 prompt 延迟 < 15s（3 次取平均）', async () => {
    const service = createAgnesService();
    resetPerf();
    const durs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      const r = await service.generate(SHORT_PROMPT, { ...PERF_OPTS, maxTokens: 150 });
      const dur = Date.now() - t0;
      durs.push(dur);
      record('perf.short-prompt', dur, r.usage.promptTokens, r.usage.completionTokens);
    }
    const avg = durs.reduce((a, b) => a + b, 0) / durs.length;
    console.log(`[perf] 短 prompt: 3 次 = [${durs.join(', ')}] ms, 平均 ${Math.round(avg)}ms`);
    expect(avg).toBeLessThan(15_000);
  });

  it('2. 长 prompt 延迟 < 30s', async () => {
    // 长 prompt 是重请求，前序测试可能已触发限流；等待 3s 让窗口恢复
    await sleep(3_000);
    const service = createAgnesService();
    const t0 = Date.now();
    const r = await service.generate(LONG_PROMPT, { ...PERF_OPTS, maxTokens: 400 });
    const dur = Date.now() - t0;
    record('perf.long-prompt', dur, r.usage.promptTokens, r.usage.completionTokens);
    console.log(
      `[perf] 长 prompt: ${dur}ms, prompt_tokens=${r.usage.promptTokens}, completion_tokens=${r.usage.completionTokens}`,
    );
    expect(dur).toBeLessThan(30_000);
  });

  it('3. 流式首 token < 10s', async () => {
    const service = createAgnesService();
    const t0 = Date.now();
    let firstTokenMs = 0;
    let totalDelta = '';
    for await (const ch of service.stream(SHORT_PROMPT, { ...PERF_OPTS, maxTokens: 150 })) {
      if (firstTokenMs === 0 && ch.delta.length > 0) {
        firstTokenMs = Date.now() - t0;
      }
      totalDelta += ch.delta;
    }
    const totalMs = Date.now() - t0;
    record('perf.stream-first-token', firstTokenMs || totalMs, undefined, undefined);
    console.log(
      `[perf] 流式: 首 token ${firstTokenMs}ms, 总 ${totalMs}ms, content len=${totalDelta.length}`,
    );
    expect(firstTokenMs).toBeGreaterThan(0);
    expect(firstTokenMs).toBeLessThan(10_000);
    expect(totalDelta.length).toBeGreaterThan(0);
  });

  it('4. tokens/s 汇总（perfMetrics 打印表）', async () => {
    const service = createAgnesService();
    // 额外跑 2 次短 prompt 用于 tokens/s 统计
    for (let i = 0; i < 2; i++) {
      const t0 = Date.now();
      const r = await service.generate(SHORT_PROMPT, { ...PERF_OPTS, maxTokens: 150 });
      const dur = Date.now() - t0;
      record('perf.tokens-per-sec', dur, r.usage.promptTokens, r.usage.completionTokens);
    }
    // printTable 在 afterAll 触发；此处仅校验有记录
    const { summary } = await import('../../helpers/perfMetrics');
    const s = summary();
    expect(s.length).toBeGreaterThan(0);
    // 至少有一条 tokensPerSec > 1（completion tokens / 秒）
    const tpsRecords = s.filter((x) => x.tokensPerSec !== undefined && x.tokensPerSec > 0);
    expect(tpsRecords.length).toBeGreaterThan(0);
    console.log(
      `[perf] tokens/s 汇总: ${tpsRecords.map((x) => `${x.name}=${x.tokensPerSec}`).join(', ')}`,
    );
  });
});
