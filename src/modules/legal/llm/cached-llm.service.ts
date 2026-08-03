/**
 * CachedLlmService —— LLM 增强包装器（A3-W1，A3 §3.2-3.3）。
 *
 * 包装器模式：实现 LlmService 接口，包裹 legacy LlmServiceImpl，
 * 对调用方（IntentRouter / OrchestratorService）完全透明。
 * 新增能力：
 *   1. L3 llm_cache 命中直返（promptHash = sha256(messages+model+promptVersion+采样参数)）
 *   2. CircuitBreaker 熔断保护（generate 走 execute，stream 走 executeStream）
 *   3. 法条引用提取写回 affectedLawArticles（供 LawUpdatePipeline 批量失效）
 *
 * 容错原则（A3 §3.3）：缓存读/写失败均降级不阻塞主流程；熔断器不可用时直连 legacy。
 *
 * 设计依据：A3 §3.2-3.3；06 §八 LlmService 契约；05 llm_cache schema。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  LlmService,
  ChatMessage,
  LlmOpts,
  LlmResponse,
  LlmChunk,
  LawRefCheckResult,
} from '../../../types/llm';
import { extractLawRefs } from '../../../services/legal/llm/lawRefExtractor';
import { CacheService } from '../../platform/cache/cache.service';
import { AuditLogService } from '../../platform/audit/audit-log.service';
import { AppLoggerService } from '../../platform/logger/logger.service';
import { CircuitBreaker } from './circuit-breaker';

/** legacy LlmServiceImpl 注入 token（由 LlmModule 工厂提供） */
export const LEGACY_LLM_TOKEN = 'LEGACY_LLM_SERVICE';

/** 缓存命中时返回的占位 model 名（真实 model 未持久化在响应字符串中） */
const CACHED_MODEL_TAG = 'cached';

@Injectable()
export class CachedLlmService implements LlmService {
  constructor(
    @Inject(LEGACY_LLM_TOKEN) private readonly legacy: LlmService,
    @Optional() private readonly cache?: CacheService,
    @Optional() private readonly breaker?: CircuitBreaker,
    @Optional() private readonly audit?: AuditLogService,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  /**
   * 非流式生成（带缓存 + 熔断）。
   *
   * 流程（A3 §3.2）：
   *   1. enableCache !== false 且 cache 可用 → 查缓存，命中直返（usage 全 0，raw.fromCache=true）
   *   2. 未命中 → breaker.execute(legacy.generate)
   *   3. 成功 → extractLawRefs 提取法条 → setLlmCache 写回（best-effort）
   *   4. audit.write('llm_call', {cacheHit})
   */
  async generate(input: string | ChatMessage[], opts?: LlmOpts): Promise<LlmResponse> {
    const messages = normalizeMessages(input);
    const enableCache = opts?.enableCache !== false;
    const promptHash = this.computeHash(messages, opts);

    // 1. 缓存查询（best-effort，失败降级）
    if (enableCache && this.cache) {
      try {
        const cached = await this.cache.getLlmCache(promptHash);
        if (cached !== null) {
          this.audit?.write('llm_call', { cacheHit: true, promptHash });
          this.logger?.debug('LLM cache hit', { promptHash });
          return {
            content: cached,
            model: opts?.model ?? CACHED_MODEL_TAG,
            finishReason: 'stop',
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            raw: { fromCache: true },
          };
        }
      } catch (err) {
        this.logger?.warn('LLM cache read failed, degrading to legacy', {
          promptHash,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2. 调用 legacy（经熔断保护）
    const result = this.breaker
      ? await this.breaker.execute(() => this.legacy.generate(input, opts))
      : await this.legacy.generate(input, opts);

    // 3. 写回缓存（best-effort）
    if (enableCache && this.cache) {
      try {
        const lawRefs = extractLawRefs(result.content);
        await this.cache.setLlmCache(promptHash, result.content, {
          model: result.model,
          promptVersion: opts?.promptVersion !== undefined ? String(opts.promptVersion) : undefined,
          affectedLawArticles: lawRefs.map((r) => r.ref),
        });
      } catch (err) {
        this.logger?.warn('LLM cache write failed, degrading', {
          promptHash,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 4. 审计
    this.audit?.write('llm_call', {
      cacheHit: false,
      promptHash,
      model: result.model,
      tokens: result.usage?.totalTokens,
    });

    return result;
  }

  /**
   * 流式生成（不查缓存，经熔断保护）。
   *
   * 流式结果不写缓存（部分增量难以稳定哈希）；熔断经 executeStream 包裹，
   * 迭代正常结束记 success，迭代中抛错记 failure。
   */
  async *stream(input: string | ChatMessage[], opts?: LlmOpts): AsyncIterable<LlmChunk> {
    if (this.breaker) {
      yield* this.breaker.executeStream(() => this.legacy.stream(input, opts));
      return;
    }
    yield* this.legacy.stream(input, opts);
  }

  /** 法条引用校验：直接委托 legacy（本地正则，无需缓存/熔断） */
  async validateLawRefs(text: string): Promise<LawRefCheckResult> {
    return this.legacy.validateLawRefs(text);
  }

  /**
   * 计算 promptHash = sha256(JSON.stringify({messages, model, promptVersion, 采样参数}))。
   * 注意：signal/timeoutMs/maxRetries 不参与哈希（与响应内容无关）。
   */
  private computeHash(messages: ChatMessage[], opts?: LlmOpts): string {
    const payload = JSON.stringify({
      messages,
      model: opts?.model,
      promptVersion: opts?.promptVersion,
      temperature: opts?.temperature,
      maxTokens: opts?.maxTokens,
      topP: opts?.topP,
      stop: opts?.stop,
    });
    return createHash('sha256').update(payload, 'utf8').digest('hex');
  }
}

/** 输入归一化：字符串 → [{role:'user', content}]（与 legacy LlmServiceImpl 一致） */
function normalizeMessages(input: string | ChatMessage[]): ChatMessage[] {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }
  return input;
}
