/**
 * NestJS 根模块（A1-W1 + A1-W2 扩展）。
 *
 * 整合：
 *   ConfigModule（Joi 校验）
 *   DatabaseModule（9 集合 schema）
 *   RedisModule（L2 缓存客户端，全局）
 *   LoggerModule（结构化 JSON 日志）
 *   PlatformModule（6 横切：Cache/Pii/Audit/FeatureFlag/ContentSafety，Logger 已直接挂）
 *   AuthModule（JWT 鉴权 + 登录端点）
 *   HealthModule（/health）
 *
 * 设计依据：A1 §三 NestJS 工程结构 + §六 平台横切模块。
 *
 * A1-W3 起挂载：LegalModule（intent/rule/memory/chat）。
 */
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { validationSchema } from './app-config/validation.schema';
import appConfig from './app-config/configuration';
import { DatabaseModule } from './infra/database/database.module';
import { RedisModule } from './infra/redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { PlatformModule } from './modules/platform/platform.module';
import { AuthModule } from './modules/auth/auth.module';
import { LegalModule } from './modules/legal/legal.module';
import { TraceContextMiddleware } from './common/middleware/trace-context.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      validationSchema,
      validationOptions: {
        abortEarly: false, // 报告所有错误而非首个
      },
    }),
    // 全局 IP 级限流（@SkipThrottle 已在 /v1/chat SSE 与 /health 上豁免）
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('app.throttle.ttlMs') ?? 60_000,
          limit: config.get<number>('app.throttle.limit') ?? 100,
        },
      ],
    }),
    DatabaseModule,
    RedisModule,
    PlatformModule,
    AuthModule,
    LegalModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // TraceContext 中间件全路由生效，确保所有请求有 traceId
    consumer.apply(TraceContextMiddleware).forRoutes('*');
  }
}
