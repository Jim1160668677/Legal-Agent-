/**
 * AgnesEmbeddingProvider —— 真实 Embedding API（OpenAI 兼容 /embeddings 端点，A2-W2）。
 *
 * 需 EMBEDDING_API_KEY，provider=agnes 时启用；默认 mock（无外部依赖）。
 * 含超时控制（AbortController，30s）与错误映射，对齐 A1 LLM HTTP 封装风格。
 *
 * 设计依据：A2 §五 Embedding 接入；A1 http.ts 超时控制模式。
 */
import { Injectable } from '@nestjs/common';
import { EmbeddingConfig } from '../embedding.types';
import type { EmbeddingProvider } from '../embedding.types';

const EMBEDDING_TIMEOUT_MS = 30_000;

@Injectable()
export class AgnesEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'agnes';
  readonly dimension: number;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(cfg: EmbeddingConfig) {
    this.apiKey = cfg.apiKey;
    this.baseUrl = cfg.baseUrl;
    this.model = cfg.model;
    this.dimension = cfg.dimension;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) {
      throw new Error('AgnesEmbeddingProvider 未配置 EMBEDDING_API_KEY');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);
    try {
      const resp = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`Agnes embedding API 错误 ${resp.status}: ${body.slice(0, 200)}`);
      }
      const data = (await resp.json()) as { data: Array<{ embedding: number[] }> };
      return data.data.map((d) => d.embedding);
    } finally {
      clearTimeout(timer);
    }
  }
}
