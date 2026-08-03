/**
 * 健康检查端点（A1-W1 + Phase 1.2 readiness）。
 *
 * 路由：
 *   GET /health       → liveness 探针：进程存活即 200（不检查依赖）
 *   GET /health/ready → readiness 探针：检查 mongo + redis 连通性，全 up 才 200，否则 503
 *
 * 设计依据：
 *   - A1 §十三第 1 项：NestJS 服务可独立启动，/health 返回 200
 *   - Phase 1.2：为 SLB/K8s 就绪探针提供 /health/ready，避免在依赖抖动时把流量打入实例
 */
import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';

/** redis.ping() 超时阈值（ioredis 在断连时会自动重试，必须主动超时避免挂住） */
const READY_PING_TIMEOUT_MS = 2000;

/**
 * Phase 2.5：健康检查端点排除全局限流。
 *
 * SLB / K8s 探针高频探活（默认 2 秒一次，多探针叠加每分钟 30+ 次），
 * 若被 Throttler 命中 429，SLB 会判定实例不健康并触发重启循环，
 * 导致服务雪崩。类级 @SkipThrottle() 豁免 /health 与 /health/ready。
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    @InjectConnection() private readonly mongo: Connection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Liveness：进程存活即 200（不检查依赖，避免 redis 抖动导致容器被反复重启） */
  @Get()
  check(): { status: string; uptime: number; timestamp: string } {
    return {
      status: 'ok',
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness：检查 mongo + redis 连通性。
   * 全 up → 200 {status:'ready', checks, timestamp}
   * 任一 down → 503 {status:'degraded', checks, timestamp}（HttpExceptionFilter 包信封）
   */
  @Get('ready')
  async ready(): Promise<{
    status: 'ready' | 'degraded';
    checks: { mongo: 'up' | 'down'; redis: 'up' | 'down' };
    timestamp: string;
  }> {
    const mongoUp = this.mongo.readyState === 1; // 1 = connected
    const redisUp = await this.pingRedisWithTimeout();

    const checks = {
      mongo: mongoUp ? ('up' as const) : ('down' as const),
      redis: redisUp ? ('up' as const) : ('down' as const),
    };
    const status: 'ready' | 'degraded' = mongoUp && redisUp ? 'ready' : 'degraded';
    const timestamp = new Date().toISOString();

    if (status === 'degraded') {
      // 抛 503，由 HttpExceptionFilter 包装为统一信封 {code:5030, message, traceId, data:null}
      // filter 设计：错误响应 data 恒为 null，详情放 message（K8s/SLB 只看状态码，message 供运维排查）
      throw new ServiceUnavailableException({
        code: 5030,
        message: `service degraded: mongo=${checks.mongo}, redis=${checks.redis}`,
      });
    }
    return { status, checks, timestamp };
  }

  /**
   * 调 redis.ping()，2s 超时保护。
   * ioredis 在断连时会自动重试（retryStrategy），ping 可能挂住数秒，必须主动超时。
   */
  private async pingRedisWithTimeout(): Promise<boolean> {
    try {
      const result = await Promise.race<string>([
        this.redis.ping(),
        new Promise<string>((_, reject) =>
          setTimeout(
            () => reject(new Error(`redis ping timeout ${READY_PING_TIMEOUT_MS}ms`)),
            READY_PING_TIMEOUT_MS,
          ),
        ),
      ]);
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}
