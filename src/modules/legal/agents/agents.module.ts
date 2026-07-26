/**
 * AgentsModule —— Agent 域模块（A4-W1 基座 + A4-W2 7 核心 Agent）。
 *
 * 装配：
 *   1. AgentRegistry（进程级单例，Agent 注册与发现）
 *   2. 7 核心 Agent（A4-W2）：
 *      - LawLookupAgent（law.lookup，包装 RuleEngine）
 *      - LegalQaAgent（legal.qa，包装 RuleEngine + KnowledgeBase）
 *      - CaseSearchAgent（case.search，包装 RagService）
 *      - ProcessGuideAgent（process.guide / material.checklist，包装 KnowledgeBase）
 *      - DocumentAgent（document.generate / document.export，包装 DocumentGenerator + ExportService）
 *      - CaseAnalysisAgent（case.analyze，包装 RagService + LlmService）
 *      - MemoryAgent（memory.read / memory.write，包装 MemoryManager）
 *
 * 横切依赖（BaseAgent 注入）：
 *   - PiiModule：PiiService（PII 边界校验）
 *   - AuditModule：AuditLogService（agent_invoke 审计）
 *   - LoggerModule：AppLoggerService（结构化日志）
 *
 * 业务依赖（各 Agent 包装的服务）：
 *   - RuleEngineModule / MemoryModule（A4-W2 新抽出，原内联在 LegalModule）
 *   - KnowledgeBaseModule / RagModule / LlmModule / DocumentModule / ExportModule
 *
 * 注册时机：onModuleInit 时统一 registry.register(agent)。
 *   - 选择统一注册而非各 Agent 自注册：避免 7 个 Agent 重复实现 OnModuleInit，集中管理注册顺序。
 *
 * A4-W3 阶段：OrchestratorAgent 加入（依赖 AgentRegistry 调度）。
 * A4-W4 阶段：4 桩 Agent 加入（tool/nlu/reasoning/lawyer-review）。
 *
 * 设计依据：A4 §四；A4 §五 5.1 + 5.3；A4 §6.2 编排计划。
 */
import { Module } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { LoggerModule } from '../../platform/logger/logger.module';
import { AuditModule } from '../../platform/audit/audit.module';
import { PiiModule } from '../../platform/pii/pii.module';
import { RuleEngineModule } from '../rule/rule-engine.module';
import { MemoryModule } from '../memory/memory.module';
import { KnowledgeBaseModule } from '../knowledge/knowledge-base.module';
import { RagModule } from '../retrieval/rag.module';
import { LlmModule } from '../llm/llm.module';
import { IntentModule } from '../intent/intent.module';
import { DocumentModule } from '../document/document.module';
import { ExportModule } from '../export/export.module';
import { ToolModule } from '../../../services/legal/tools/tool.module';
import { NluModule } from '../nlu/nlu.module';
import { AgentRegistry } from './registry';
import { LawLookupAgent } from './law-lookup.agent';
import { LegalQaAgent } from './legal-qa.agent';
import { CaseSearchAgent } from './case-search.agent';
import { ProcessGuideAgent } from './process-guide.agent';
import { DocumentAgent } from './document.agent';
import { CaseAnalysisAgent } from './case-analysis.agent';
import { MemoryAgent } from './memory.agent';
import { OrchestratorAgent } from './orchestrator.agent';
import { ToolAgent } from './tool.agent';
import { NluAgent } from './nlu.agent';
import { ReasoningAgent, LawyerReviewAgent } from './stub.agent';

@Module({
  imports: [
    // 横切依赖（BaseAgent 注入）
    LoggerModule,
    AuditModule,
    PiiModule,
    // 业务依赖（各 Agent 包装的服务）
    RuleEngineModule,
    MemoryModule,
    KnowledgeBaseModule,
    RagModule,
    LlmModule,
    IntentModule,
    DocumentModule,
    ExportModule,
    // v2.3-W1：工具域模块（8 个 LegalTool + ToolRegistry）
    ToolModule,
    // v2.3-W4：NLU 域模块（EntityExtractor + ClarificationManager + CompoundIntentSplitter）
    NluModule,
  ],
  providers: [
    AgentRegistry,
    // 8 核心 Agent（A4-W2 + A4-W3）
    LawLookupAgent,
    LegalQaAgent,
    CaseSearchAgent,
    ProcessGuideAgent,
    DocumentAgent,
    CaseAnalysisAgent,
    MemoryAgent,
    OrchestratorAgent,
    // 1 工具 Agent（v2.3-W1）+ 1 NLU Agent（v2.3-W4 接入 NluModule）+ 2 桩 Agent
    ToolAgent,
    NluAgent,
    ReasoningAgent,
    LawyerReviewAgent,
  ],
  exports: [AgentRegistry, OrchestratorAgent],
})
export class AgentsModule implements OnModuleInit {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly lawLookup: LawLookupAgent,
    private readonly legalQa: LegalQaAgent,
    private readonly caseSearch: CaseSearchAgent,
    private readonly processGuide: ProcessGuideAgent,
    private readonly document: DocumentAgent,
    private readonly caseAnalysis: CaseAnalysisAgent,
    private readonly memory: MemoryAgent,
    private readonly orchestrator: OrchestratorAgent,
    private readonly tool: ToolAgent,
    private readonly nlu: NluAgent,
    private readonly reasoning: ReasoningAgent,
    private readonly lawyerReview: LawyerReviewAgent,
  ) {}

  onModuleInit(): void {
    // 统一注册 12 Agent（8 完整 + 1 工具 + 1 NLU + 2 桩，A4 验收 #1）
    // 顺序：先注册叶子 agent，再注册桩 agent，最后注册编排器
    this.registry.register(this.lawLookup);
    this.registry.register(this.legalQa);
    this.registry.register(this.caseSearch);
    this.registry.register(this.processGuide);
    this.registry.register(this.document);
    this.registry.register(this.caseAnalysis);
    this.registry.register(this.memory);
    // 1 工具 Agent（ToolRegistry）+ 1 NLU Agent（NluModule 三服务）+ 2 桩 Agent
    this.registry.register(this.tool);
    this.registry.register(this.nlu);
    this.registry.register(this.reasoning);
    this.registry.register(this.lawyerReview);
    // 编排器最后注册（依赖前序 agent）
    this.registry.register(this.orchestrator);
  }
}
