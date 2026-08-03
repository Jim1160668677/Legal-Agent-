/**
 * VisionModule — 图像识别模块装配（多模型主备切换）。
 *
 * 装配：
 *   1. VISION_PROVIDERS（Symbol token）：两个 ZhipuVisionProvider 实例
 *      - glm-4v-flash（priority=1，主模型，完全免费）
 *      - glm-4v-plus（priority=2，备用模型）
 *   2. VisionProviderRegistry：注册 providers + 健康状态跟踪
 *   3. VisionService：核心服务，故障自动切换 + 审计日志
 *   4. OcrServiceImpl：ToolOcrService 实现，对接 LicenseOcrTool
 *   5. VisionController：REST API 端点
 *
 * 导出：VisionService + OcrServiceImpl（供 ToolAgent 注入 ctx.ocrService）
 *
 * 配置依赖：app.vision.{primaryModel, fallbackModel, timeoutMs, maxRetries, cooldownMs}
 *           + app.llm.zhipu.{apiKey, baseUrl}（复用智谱 API Key）
 *
 * 设计依据：方案 .trae/documents/图像识别系统-多模型主备切换.md §vision.module.ts
 */

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from '../../platform/logger/logger.module';
import { AuditModule } from '../../platform/audit/audit.module';
import { VisionController } from './vision.controller';
import { VisionService } from './vision.service';
import { VisionProviderRegistry } from './vision-provider-registry';
import { OcrServiceImpl } from './ocr-service.impl';
import { ZhipuVisionProvider } from './zhipu-vision.provider';

/** Provider 列表注入 token */
export const VISION_PROVIDERS = Symbol('VISION_PROVIDERS');

@Module({
  imports: [LoggerModule, AuditModule],
  controllers: [VisionController],
  providers: [
    {
      provide: VISION_PROVIDERS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const apiKey = config.get<string>('app.llm.zhipu.apiKey') ?? '';
        const baseURL =
          config.get<string>('app.llm.zhipu.baseUrl') ?? 'https://open.bigmodel.cn/api/paas/v4';
        const primaryModel = config.get<string>('app.vision.primaryModel') ?? 'glm-4v-flash';
        const fallbackModel = config.get<string>('app.vision.fallbackModel') ?? 'glm-4v-plus';
        const timeoutMs = config.get<number>('app.vision.timeoutMs', 30_000) ?? 30_000;
        const maxRetries = config.get<number>('app.vision.maxRetries', 2) ?? 2;
        const baseRetryDelayMs = config.get<number>('app.llm.baseRetryDelayMs', 1000) ?? 1000;

        // 主模型（priority=1）
        const primary = new ZhipuVisionProvider({
          apiKey,
          baseURL,
          model: primaryModel,
          priority: 1,
          timeoutMs,
          maxRetries,
          baseRetryDelayMs,
          maxTokens: 1000,
          temperature: 0.1,
        });

        // 备用模型（priority=2）
        const fallback = new ZhipuVisionProvider({
          apiKey,
          baseURL,
          model: fallbackModel,
          priority: 2,
          timeoutMs,
          maxRetries,
          baseRetryDelayMs,
          maxTokens: 1000,
          temperature: 0.1,
        });

        return [primary, fallback];
      },
    },
    {
      provide: VisionProviderRegistry,
      inject: [VISION_PROVIDERS, ConfigService],
      useFactory: (providers: ZhipuVisionProvider[], config: ConfigService) => {
        const cooldownMs = config.get<number>('app.vision.cooldownMs', 30_000) ?? 30_000;
        const registry = new VisionProviderRegistry(cooldownMs);
        registry.registerAll(providers);
        return registry;
      },
    },
    VisionService,
    OcrServiceImpl,
  ],
  exports: [VisionService, OcrServiceImpl],
})
export class VisionModule {}
