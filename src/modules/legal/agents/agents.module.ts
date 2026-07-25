/**
 * AgentsModule —— Agent 域模块（A4-W1）。
 *
 * 装配 AgentRegistry（进程级单例），提供横切依赖：
 *   - PiiModule：PiiService（PII 边界校验，BaseAgent 注入）
 *   - AuditModule：AuditLogService（agent_invoke 审计，BaseAgent 注入）
 *   - LoggerModule：AppLoggerService（结构化日志，BaseAgent 注入）
 *
 * A4-W1 阶段：仅提供 AgentRegistry + 横切依赖。
 * A4-W2 阶段：8 核心 Agent 作为 provider 加入（law-lookup/legal-qa/...）。
 * A4-W3 阶段：OrchestratorAgent 加入，编排调度。
 * A4-W4 阶段：4 桩 Agent 加入（tool/nlu/reasoning/lawyer-review）。
 *
 * AgentRegistry 在 onModuleInit 时由各 Agent 自注册（实现 OnModuleInit 接口），
 * 或由 AgentsModule 统一注册。A4-W1 采用惰性注册：Agent 实例化时自调 registry.register()。
 *
 * 设计依据：A4 §四；A4 §五 5.3 横切注入。
 */
import { Module } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { LoggerModule } from '../../platform/logger/logger.module';
import { AuditModule } from '../../platform/audit/audit.module';
import { PiiModule } from '../../platform/pii/pii.module';
import { AgentRegistry } from './registry';

@Module({
  imports: [LoggerModule, AuditModule, PiiModule],
  providers: [AgentRegistry],
  exports: [AgentRegistry],
})
export class AgentsModule implements OnModuleInit {
  constructor(private readonly registry: AgentRegistry) {}

  onModuleInit(): void {
    // A4-W1：AgentRegistry 为空，待 A4-W2 各 Agent 自注册
    // A4-W2+：各 Agent 实现 OnModuleInit，构造时自调 this.registry.register(this)
    // 此处仅做启动校验：确保 registry 可用
    void this.registry; // 占位，避免未使用警告
  }
}
