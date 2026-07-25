/**
 * EmbeddingModule —— 向量化与向量存储模块（A2-W2，A2 §五/§六）。
 *
 * 可插拔架构：
 *   - EMBEDDING_PROVIDER_TOKEN：按 app.embedding.provider 选择 Mock 或 Agnes Provider
 *   - VECTOR_STORE_TOKEN：默认 InMemoryVectorStore（生产可替换为 Atlas VectorSearch）
 *   - EmbeddingService：embed/embedBatch + Redis 向量缓存
 *
 * 依赖：
 *   - ConfigService（读取 app.embedding.* 配置）
 *   - CacheService（可选，向量缓存；缺失时降级直连 Provider）
 *   - AppLoggerService（可选，错误日志）
 *
 * 设计依据：A2 §五 Embedding 接入；A1 §三 NestJS 工程结构。
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Provider } from '@nestjs/common';
import { LoggerModule } from '../../platform/logger/logger.module';
import { CacheModule } from '../../platform/cache/cache.module';
import { EmbeddingService } from './embedding.service';
import { InMemoryVectorStore } from './vector-store';
import { MockEmbeddingProvider } from './providers/mock-embedding.provider';
import { AgnesEmbeddingProvider } from './providers/agnes-embedding.provider';
import {
  EMBEDDING_PROVIDER_TOKEN,
  VECTOR_STORE_TOKEN,
  type EmbeddingProvider,
  type EmbeddingConfig,
} from './embedding.types';

/**
 * EMBEDDING_PROVIDER_TOKEN 的工厂：按 app.embedding.provider 选择实现。
 * - mock：MockEmbeddingProvider（默认，开发/测试，无外部依赖）
 * - agnes：AgnesEmbeddingProvider（需 EMBEDDING_API_KEY，真实语义向量）
 */
export const embeddingProviderFactory: Provider = {
  provide: EMBEDDING_PROVIDER_TOKEN,
  inject: [ConfigService],
  useFactory: (config: ConfigService): EmbeddingProvider => {
    const cfg = config.get<EmbeddingConfig>('app.embedding');
    if (!cfg) {
      // 配置缺失时安全降级到 mock（不应发生，validationSchema 有默认值）
      return new MockEmbeddingProvider(1536);
    }
    if (cfg.provider === 'agnes') {
      return new AgnesEmbeddingProvider(cfg);
    }
    return new MockEmbeddingProvider(cfg.dimension);
  },
};

/** VECTOR_STORE_TOKEN 的 Provider：默认 InMemoryVectorStore */
export const vectorStoreProvider: Provider = {
  provide: VECTOR_STORE_TOKEN,
  useClass: InMemoryVectorStore,
};

@Module({
  imports: [LoggerModule, CacheModule],
  providers: [EmbeddingService, embeddingProviderFactory, vectorStoreProvider],
  exports: [EmbeddingService, VECTOR_STORE_TOKEN],
})
export class EmbeddingModule {}
