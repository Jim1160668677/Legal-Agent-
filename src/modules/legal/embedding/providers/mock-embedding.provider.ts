/**
 * MockEmbeddingProvider —— 确定性哈希向量（A2-W2 默认 Provider）。
 *
 * 相同文本生成相同向量（SHA-256 哈希填充 + L2 归一化），用于开发/测试，无外部依赖。
 * 注：哈希向量无真实语义相似度，仅验证向量存储/检索机制；真实语义靠 AgnesEmbeddingProvider。
 *
 * 设计依据：A2 §五 Embedding 接入；A1 ContentSafety PassThrough 可插拔模式。
 */
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { EmbeddingProvider } from '../embedding.types';

@Injectable()
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'mock';
  readonly dimension: number;

  constructor(dimension = 1536) {
    this.dimension = dimension;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.hashToVector(t));
  }

  /** SHA-256 哈希填充至 dimension 维 + L2 归一化（余弦相似度友好） */
  private hashToVector(text: string): number[] {
    const hash = createHash('sha256').update(text).digest();
    const vec = new Array<number>(this.dimension);
    let norm = 0;
    for (let i = 0; i < this.dimension; i++) {
      const byte = hash[i % hash.length];
      vec[i] = byte / 127.5 - 1; // 映射到 [-1, 1]
      norm += vec[i] * vec[i];
    }
    const sqrt = Math.sqrt(norm) || 1;
    for (let i = 0; i < this.dimension; i++) {
      vec[i] /= sqrt;
    }
    return vec;
  }
}
