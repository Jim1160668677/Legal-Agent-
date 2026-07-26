/**
 * ToolModule —— 法律工具域模块（v2.3-W1，14-tool-design.md §二）。
 *
 * 装配：
 *   1. ToolRegistry（进程级单例）
 *   2. 8 个 LegalTool 实现：
 *      - LawValidityTool（法条效力查询）
 *      - PeriodCalculatorTool（期间计算器）
 *      - CompensationQueryTool（赔偿标准查询）
 *      - CauseClassifierTool（案由分类）
 *      - SentencingGuideTool（量刑指导）
 *      - ClauseRecommenderTool（条款推荐）
 *      - LicenseOcrTool（证照 OCR，骨架）
 *      - DocumentReviewerTool（文书审核，骨架）
 *
 * 注册时机：onModuleInit 时统一 registry.register(tool)。
 *   - 选择统一注册而非各 Tool 自注册：避免 8 个 Tool 重复实现 OnModuleInit
 *
 * 暴露：
 *   - ToolRegistry（供 ToolAgent 注入调度）
 *
 * 设计依据：14-tool-design.md §2.5 ToolRegistry；§一 1.3 与 v2.1 Agent 的关系。
 */
import { Module } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ToolRegistry } from './registry';
import { LawValidityTool } from './law-validity.tool';
import { PeriodCalculatorTool } from './period-calculator.tool';
import { CompensationQueryTool } from './compensation-query.tool';
import { CauseClassifierTool } from './cause-classifier.tool';
import { SentencingGuideTool } from './sentencing-guide.tool';
import { ClauseRecommenderTool } from './clause-recommender.tool';
import { LicenseOcrTool } from './license-ocr.tool';
import { DocumentReviewerTool } from './document-reviewer.tool';

@Module({
  providers: [
    ToolRegistry,
    LawValidityTool,
    PeriodCalculatorTool,
    CompensationQueryTool,
    CauseClassifierTool,
    SentencingGuideTool,
    ClauseRecommenderTool,
    LicenseOcrTool,
    DocumentReviewerTool,
  ],
  exports: [ToolRegistry],
})
export class ToolModule implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly lawValidity: LawValidityTool,
    private readonly periodCalculator: PeriodCalculatorTool,
    private readonly compensationQuery: CompensationQueryTool,
    private readonly causeClassifier: CauseClassifierTool,
    private readonly sentencingGuide: SentencingGuideTool,
    private readonly clauseRecommender: ClauseRecommenderTool,
    private readonly licenseOcr: LicenseOcrTool,
    private readonly documentReviewer: DocumentReviewerTool,
  ) {}

  onModuleInit(): void {
    // 统一注册 8 工具（顺序按 toolId 字母序）
    this.registry.register(this.lawValidity);
    this.registry.register(this.periodCalculator);
    this.registry.register(this.compensationQuery);
    this.registry.register(this.causeClassifier);
    this.registry.register(this.sentencingGuide);
    this.registry.register(this.clauseRecommender);
    this.registry.register(this.licenseOcr);
    this.registry.register(this.documentReviewer);
  }
}
