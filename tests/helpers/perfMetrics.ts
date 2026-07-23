/**
 * 性能指标记录器。
 *
 * 在集成测试中累积记录每次调用的耗时与 token 数，
 * 测试结束后打印汇总表，供测试报告引用。
 */

export interface PerfRecord {
  name: string;
  durationMs: number;
  tokensIn?: number;
  tokensOut?: number;
}

const records: PerfRecord[] = [];

/** 记录一次性能数据 */
export function record(
  name: string,
  durationMs: number,
  tokensIn?: number,
  tokensOut?: number,
): void {
  records.push({ name, durationMs, tokensIn, tokensOut });
}

/** 清空记录（每个测试文件独立） */
export function resetPerf(): void {
  records.length = 0;
}

export interface PerfSummary {
  name: string;
  runs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  avgTokensOut?: number;
  tokensPerSec?: number;
}

/** 按 name 聚合汇总 */
export function summary(): PerfSummary[] {
  const groups = new Map<string, PerfRecord[]>();
  for (const r of records) {
    const arr = groups.get(r.name) ?? [];
    arr.push(r);
    groups.set(r.name, arr);
  }
  const out: PerfSummary[] = [];
  for (const [name, arr] of groups) {
    const durs = arr.map((r) => r.durationMs);
    const toksOut = arr.map((r) => r.tokensOut ?? 0);
    const avgMs = durs.reduce((a, b) => a + b, 0) / durs.length;
    const avgTokensOut = toksOut.reduce((a, b) => a + b, 0) / toksOut.length;
    out.push({
      name,
      runs: arr.length,
      avgMs: Math.round(avgMs),
      minMs: Math.min(...durs),
      maxMs: Math.max(...durs),
      avgTokensOut: Math.round(avgTokensOut),
      tokensPerSec: avgMs > 0 ? Number((avgTokensOut / (avgMs / 1000)).toFixed(2)) : undefined,
    });
  }
  return out;
}

/** 打印汇总表到 console（供报告引用） */
export function printTable(): void {
  const s = summary();
  if (s.length === 0) {
    console.log('[perf] no records');
    return;
  }
  console.log('[perf] summary:');
  console.table(s);
}

/** 获取原始记录（报告生成用） */
export function rawRecords(): readonly PerfRecord[] {
  return records;
}
