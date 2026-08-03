/**
 * JobController —— 异步任务状态查询端点（A3-W4，A3 §八）。
 *
 * 端点：
 *   GET /v1/jobs/:jobId    查询任务状态（不含 params，避免敏感数据外泄）
 *
 * 鉴权：JwtAuthGuard
 * 越权校验：仅任务所有者可查看（admin 例外）；非所有者返回 404（避免泄露任务存在性）
 *
 * 设计依据：A3 §八 简单轮询模式；06-api-spec。
 */
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { JwtPayload } from '../../auth/auth.types';
import { JobService } from './job.service';

@Controller('v1/jobs')
@UseGuards(JwtAuthGuard)
export class JobController {
  constructor(private readonly jobService: JobService) {}

  /**
   * 查询任务状态。
   * 默认不含 params（避免敏感数据外泄）；admin 可通过 includeParams=true 取解密后的 params。
   */
  @Get(':jobId')
  async getStatus(
    @Param('jobId') jobId: string,
    @CurrentUser() user: JwtPayload,
    @Query('includeParams') includeParams?: string,
  ) {
    const isAdmin = user.role === 'admin';
    // 越权校验：先 assert owner，再返回状态
    await this.jobService.assertOwner(jobId, user.sub, isAdmin);

    const include = includeParams === 'true' && isAdmin;
    return this.jobService.getStatus(jobId, include);
  }
}
