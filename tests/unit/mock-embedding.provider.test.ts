/**
 * MockEmbeddingProvider 单元测试（A2-W2 确定性哈希向量）。
 *
 * 覆盖：
 *   - 相同文本 → 相同向量；不同文本 → 不同向量
 *   - L2 归一化（||v|| = 1）、分量在 [-1,1]
 *   - 默认 1536 维 / 自定义维度
 *   - 空数组 → 空结果
 *
 * 设计依据：A2 §五 Embedding 接入。
 */
import { describe, it, expect } from 'vitest';
import { MockEmbeddingProvider } from '../../src/modules/legal/embedding/providers/mock-embedding.provider';

describe('MockEmbeddingProvider', () => {
  it('相同文本 → 相同向量（确定性）', async () => {
    const p = new MockEmbeddingProvider(8);
    const [a] = await p.embed(['劳动合同纠纷']);
    const [b] = await p.embed(['劳动合同纠纷']);
    expect(a).toEqual(b);
  });

  it('不同文本 → 不同向量', async () => {
    const p = new MockEmbeddingProvider(8);
    const [a, b] = await p.embed(['劳动合同纠纷', '交通事故赔偿']);
    expect(a).not.toEqual(b);
  });

  it('L2 归一化：||v|| ≈ 1 且分量在 [-1,1]', async () => {
    const p = new MockEmbeddingProvider(16);
    const [v] = await p.embed(['工伤认定']);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
    expect(v.every((x) => x >= -1 && x <= 1)).toBe(true);
  });

  it('默认 1536 维 / 自定义维度', async () => {
    const def = new MockEmbeddingProvider();
    const small = new MockEmbeddingProvider(4);
    const [d] = await def.embed(['x']);
    const [s] = await small.embed(['x']);
    expect(d).toHaveLength(1536);
    expect(s).toHaveLength(4);
  });

  it('空数组 → 空结果', async () => {
    const p = new MockEmbeddingProvider();
    expect(await p.embed([])).toEqual([]);
  });

  it('name = mock', () => {
    expect(new MockEmbeddingProvider().name).toBe('mock');
  });
});