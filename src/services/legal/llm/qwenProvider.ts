/**
 * QwenProvider 桩实现。
 *
 * 所有方法抛 NotImplementedError，用于验证多 provider 切换机制：
 * 当 LLM_PROVIDER=qwen 时，LlmService 委托到本 provider 即抛错，
 * 证明切换生效。实际 Qwen 接入（通义千问 dashscope）留待后续阶段。
 *
 * 设计依据：docs/design/04-module-design.md（多厂商切换）。
 */

import type { LlmProvider } from './provider';
import { NotImplementedError } from './provider';
import type { ChatMessage, LlmOpts, LlmResponse, LlmChunk } from '../../../types/llm';
import type { ProviderConfig, LlmRuntimeConfig } from '../../../config/types';

export class QwenProvider implements LlmProvider {
  readonly name = 'qwen';
  readonly defaultModel: string;
  private readonly runtime: LlmRuntimeConfig;

  constructor(cfg: ProviderConfig, runtime: LlmRuntimeConfig) {
    this.defaultModel = cfg.defaultModel;
    this.runtime = runtime;
    // runtime 暂存（桩不使用，但保留构造签名与 AgnesProvider 对称，便于 registry 统一注册）
    void this.runtime;
  }

  async generate(_messages: ChatMessage[], _opts?: LlmOpts): Promise<LlmResponse> {
    throw new NotImplementedError('QwenProvider', 'generate');
  }

  stream(_messages: ChatMessage[], _opts?: LlmOpts): AsyncIterable<LlmChunk> {
    // 抛错而非返回迭代器：调用方一旦迭代即抛
    // eslint-disable-next-line require-yield
    return (async function* () {
      throw new NotImplementedError('QwenProvider', 'stream');
    })();
  }
}
