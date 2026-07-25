/**
 * LlmModule —— LLM 域增强模块装配（A3-W1）。
 *
 * 装配内容（A3-W1 阶段 4）：
 *   - PromptRegistry：prompt 模板管理
 *   - CircuitBreaker：熔断器（Redis 共享状态，fail-open 内存兜底）
 *   - LEGACY_LLM_TOKEN：legacy LlmServiceImpl（原样复用，105 测试零回归）
 *   - CachedLlmService：包装器（缓存 + 熔断 + 法条回写）
 *   - LLM_SERVICE_TOKEN：useExisting CachedLlmService（对调用方透明替换）
 *
 * 依赖：
 *   - RedisModule（@Global，提供 REDIS_CLIENT，无需显式 import）
 *   - CacheModule（L3 llm_cache 持久化）
 *   - AuditModule（llm_call 事件审计）
 *   - LoggerModule（AppLoggerService）
 *
 * 导出 LLM_SERVICE_TOKEN 供 IntentRouter / OrchestratorService 注入；
 * 导出 PromptRegistry 供后续 DocumentGenerator / Chat 使用。
 *
 * 设计依据：A3-W1 实施计划阶段 4；A3 §3.1-3.3。
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LlmService } from '../../../types/llm';
import { LlmServiceImpl } from '../../../services/legal/llm';
import { createDefaultRegistry } from '../../../services/legal/llm/registry';
import { LLM_SERVICE_TOKEN } from '../intent/intent-router.service';
import { CacheModule } from '../../platform/cache/cache.module';
import { AuditModule } from '../../platform/audit/audit.module';
import { LoggerModule } from '../../platform/logger/logger.module';
import { buildLegacyConfig } from './llm.provider';
import { PromptRegistry } from './prompt-registry';
import { CircuitBreaker } from './circuit-breaker';
import { CachedLlmService, LEGACY_LLM_TOKEN } from './cached-llm.service';

@Module({
  imports: [CacheModule, AuditModule, LoggerModule],
  providers: [
    PromptRegistry,
    CircuitBreaker,
    // legacy LlmServiceImpl（原样复用，桥接新旧配置）
    {
      provide: LEGACY_LLM_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService): LlmService => {
        const legacyCfg = buildLegacyConfig(config);
        const registry = createDefaultRegistry(legacyCfg);
        return new LlmServiceImpl(registry);
      },
    },
    // 包装器：NestJS 按 @Optional 装饰器解析 cache/breaker/audit/logger
    CachedLlmService,
    // 对调用方透明：LLM_SERVICE_TOKEN → CachedLlmService 实例
    {
      provide: LLM_SERVICE_TOKEN,
      useExisting: CachedLlmService,
    },
  ],
  exports: [LLM_SERVICE_TOKEN, PromptRegistry, CachedLlmService],
})
export class LlmModule {}
