/**
 * AgentsController —— Agent 元信息查询（Phase 2.6 / A5）。
 *
 * 端点：
 *   GET /v1/agents  (需 JWT 鉴权)
 *
 * 职责：
 *   1. 返回对外可见的 AgentCard 列表（L-Read + L-Write-Limited）
 *   2. 不暴露 L-Internal（编排器/NLU/律师审核等内部 agent）
 *
 * 数据源：AgentRegistry.listCards() 默认过滤 L-Internal，
 *         返回结果按 agentId 字典序排序（registry.ts:137）。
 *
 * 设计依据：
 *   - A5 §API 端点补齐：当前 ~20 端点，目标 25 端点
 *   - A4 §四 listCards 默认排除 L-Internal
 *   - 11-multi-agent-architecture.md §对外能力发现
 *
 * 返回信封由 ResponseInterceptor 统一包装为：
 *   { code: 0, message: 'ok', traceId, data: { agents: AgentCard[] } }
 */
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
// AgentRegistry 是 @Injectable 服务类，constructor 注入需要 reflect-metadata 的
// design:paramtypes 记录为 AgentRegistry 类作为 DI token；import type 会被 tsc 编译器
// 擦除导致 prod 模式 DI 失败（详见 eslint.config.mjs 的 consistent-type-imports 注释）。
import { AgentRegistry } from './registry';

@ApiTags('agents')
@ApiBearerAuth()
@Controller('v1/agents')
@UseGuards(JwtAuthGuard)
export class AgentsController {
  constructor(private readonly registry: AgentRegistry) {}

  /**
   * 列出对外可见的 AgentCard。
   *
   * 默认仅返回 L-Read + L-Write-Limited（A4 §四），
   * L-Internal（orchestrator / nlu / lawyer-review / memory）不对外暴露。
   */
  @Get()
  @ApiOperation({ summary: '列出对外可见的 AgentCard（L-Read + L-Write-Limited）' })
  list(): { agents: ReturnType<AgentRegistry['listCards']> } {
    return { agents: this.registry.listCards() };
  }
}
