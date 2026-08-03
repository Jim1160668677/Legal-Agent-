/**
 * VisionService — 图像识别核心服务（v2.4）。
 *
 * 职责：
 *   - recognize(input, opts?): 按优先级遍历 provider，故障自动切换
 *   - getProviderStatus(): 返回各 provider 健康状态（供监控端点）
 *   - 每次调用记录 vision_call 审计日志（成功/失败均记）
 *
 * 故障切换流程（设计文档 §故障切换流程）：
 *   for provider in registry.sortedByPriority():
 *     try recognize → recordSuccess + audit(success) → return {...result, provider, fallbackUsed}
 *     catch → recordFailure + audit(failure) + logger.warn → continue
 *   throw VisionAllProvidersFailedError
 *
 * 设计依据：.trae/documents/图像识别系统-多模型主备切换.md §1.4 + §故障切换流程
 */
import { Injectable } from '@nestjs/common';
import { VisionProviderRegistry } from './vision-provider-registry';
import { AuditLogService } from '../../platform/audit/audit-log.service';
import { AppLoggerService } from '../../platform/logger/logger.service';
import type { VisionInput, VisionOpts, VisionResult, ProviderStatus } from './vision.types';
import { VisionAllProvidersFailedError } from './vision.types';

/** recognize 返回结果（在 VisionResult 基础上叠加调用元信息） */
export interface VisionRecognizeResult extends VisionResult {
  /** 实际命中的 provider name */
  provider: string;
  /** 是否使用了备用模型（priority !== 1） */
  fallbackUsed: boolean;
  /** 本次调用耗时（ms） */
  durationMs: number;
}

@Injectable()
export class VisionService {
  constructor(
    private readonly registry: VisionProviderRegistry,
    private readonly audit: AuditLogService,
    private readonly logger: AppLoggerService,
  ) {}

  async recognize(input: VisionInput, opts?: VisionOpts): Promise<VisionRecognizeResult> {
    const providers = this.registry.sortedByPriority();
    const failures: Array<{ provider: string; error: string }> = [];

    for (const provider of providers) {
      const start = Date.now();
      try {
        const result = await provider.recognize(input, opts);
        const durationMs = Date.now() - start;
        const fallbackUsed = provider.priority !== 1;
        this.registry.recordSuccess(provider.name);
        this.audit.write(
          'vision_call',
          {
            provider: provider.name,
            model: provider.model,
            success: true,
            durationMs,
            usage: result.usage,
            fallbackUsed,
          },
          { result: 'success' },
        );
        return { ...result, provider: provider.name, fallbackUsed, durationMs };
      } catch (err) {
        const durationMs = Date.now() - start;
        const errMsg = err instanceof Error ? err.message : String(err);
        this.registry.recordFailure(provider.name, err);
        this.audit.write(
          'vision_call',
          {
            provider: provider.name,
            model: provider.model,
            success: false,
            error: errMsg,
            durationMs,
          },
          { result: 'failure' },
        );
        this.logger.warn('Vision provider 失败，尝试下一个', {
          provider: provider.name,
          error: errMsg,
        });
        failures.push({ provider: provider.name, error: errMsg });
      }
    }

    throw new VisionAllProvidersFailedError(failures);
  }

  /** 返回各 provider 健康状态（供 GET /v1/vision/health） */
  getProviderStatus(): ProviderStatus[] {
    return this.registry.getStatus();
  }
}
