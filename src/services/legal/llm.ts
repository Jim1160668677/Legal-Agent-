/**
 * LlmService 主类 — 多供应商 LLM 服务门面。
 *
 * 对外暴露 generate/stream/validateLawRefs（对齐 src/types/llm.ts 契约），
 * 内部委托 ProviderRegistry.active provider 执行实际调用。
 *
 * 设计依据：docs/design/06-api-spec.md 第八节 LlmService 接口契约。
 */

import type {
  LlmService,
  ChatMessage,
  LlmOpts,
  LlmResponse,
  LlmChunk,
  LawRefCheckResult,
} from '../../types/llm';
import type { ProviderRegistry } from './llm/registry';
import { createDefaultRegistry } from './llm/registry';
import { extractLawRefs } from './llm/lawRefExtractor';
import { getConfig } from '../../config';

export class LlmServiceImpl implements LlmService {
  constructor(private readonly registry: ProviderRegistry) {}

  async generate(input: string | ChatMessage[], opts?: LlmOpts): Promise<LlmResponse> {
    return this.registry.active.generate(normalizeMessages(input), opts);
  }

  async *stream(input: string | ChatMessage[], opts?: LlmOpts): AsyncIterable<LlmChunk> {
    yield* this.registry.active.stream(normalizeMessages(input), opts);
  }

  /**
   * 法条引用校验（对齐设计文档 07 §2.6）。
   *
   * MVP 阶段：仅正则提取，不查 law_article 集合，全部归 unverified。
   * 后续接入法律知识库后，verified 字段由库内核实补全。
   */
  async validateLawRefs(text: string): Promise<LawRefCheckResult> {
    const refs = extractLawRefs(text);
    return {
      verified: [],
      unverified: refs,
      sanitizedText: text,
    };
  }

  /** 兼容别名：complete(prompt) = generate(prompt).content */
  async complete(prompt: string, opts?: LlmOpts): Promise<string> {
    return (await this.generate(prompt, opts)).content;
  }

  /** 暴露 registry（供测试切换 active provider） */
  get providers(): ProviderRegistry {
    return this.registry;
  }
}

/** 输入归一化：字符串 → [{role:'user', content}] */
function normalizeMessages(input: string | ChatMessage[]): ChatMessage[] {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }
  return input;
}

/**
 * 工厂：创建默认 LlmService（用默认 registry + 当前配置）。
 * 测试可传入自定义 registry。
 */
export function createLlmService(registry?: ProviderRegistry): LlmServiceImpl {
  const reg = registry ?? createDefaultRegistry(getConfig());
  return new LlmServiceImpl(reg);
}
