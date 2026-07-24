/**
 * 健康检查端点（A1-W1）。
 *
 * GET /health → { status: 'ok', uptime, timestamp }
 * 验收标准 A1 §十三第 1 项：NestJS 服务可独立启动，/health 返回 200。
 */
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  @Get()
  check(): { status: string; uptime: number; timestamp: string } {
    return {
      status: 'ok',
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }
}
