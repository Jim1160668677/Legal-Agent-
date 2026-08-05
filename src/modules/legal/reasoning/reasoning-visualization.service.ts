/**
 * ReasoningVisualizationService —— 法律推理可视化服务（v3.0 新增）。
 *
 * 核心功能：
 *   1. 从推理链中提取律师专业判断应用过程
 *   2. 生成结构化的可视化数据（节点、连线、层级）
 *   3. 支持多种视图：IRAC 流程图、专业判断应用图、法规引用关系图
 *   4. 为前端提供可直接渲染的 JSON 结构
 *
 * 可视化类型：
 *   - irac_flowchart：IRAC 四步推理流程图
 *   - expertise_influence：律师专业判断影响图
 *   - law_reference_map：法条引用关系图
 *   - risk_assessment_heatmap：风险评估热力图
 *
 * 设计依据：用户需求 4（法律推理可视化模块）。
 */

import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ReasoningChain,
  type ReasoningChainDocument,
} from '../../../infra/database/schemas/reasoning-chain.schema';
import { LawyerExpertiseKnowledgeBaseService } from '../knowledge/lawyer-expertise-knowledge-base.service';
import { AppLoggerService } from '../../platform/logger/logger.service';

// ===== 可视化类型定义 =====

/** 可视化节点 */
export interface VisualizationNode {
  id: string;
  type:
    | 'irac_step'
    | 'expertise'
    | 'rule'
    | 'issue'
    | 'application'
    | 'conclusion'
    | 'trace'
    | 'risk';
  label: string;
  description?: string;
  position?: { x: number; y: number };
  metadata?: Record<string, unknown>;
  children?: VisualizationNode[];
}

/** 可视化连线 */
export interface VisualizationEdge {
  id: string;
  source: string;
  target: string;
  type?: 'flows' | 'influences' | 'references' | 'supports';
  label?: string;
  weight?: number;
}

/** 可视化图结构 */
export interface VisualizationGraph {
  type: 'irac_flowchart' | 'expertise_influence' | 'law_reference_map' | 'risk_assessment_heatmap';
  title: string;
  nodes: VisualizationNode[];
  edges: VisualizationEdge[];
  metadata: {
    reasoningChainId: string;
    generatedAt: Date;
    expertiseAppliedCount: number;
    stepsCount: number;
  };
}

/** 可视化视图配置 */
export interface VisualizationConfig {
  includeExpertise?: boolean;
  includeTrace?: boolean;
  includeLawRefs?: boolean;
  detailLevel?: 'summary' | 'detail' | 'full';
}

/** 专业判断应用说明 */
export interface ProfessionalJudgmentExplanation {
  summary: string;
  stepByStepBreakdown: Array<{
    step: string;
    expertiseApplied: Array<{
      expertiseId: string;
      title: string;
      type: string;
      applicationNote: string;
    }>;
    influenceOnStep: string;
  }>;
  overallAssessment: string;
}

@Injectable()
export class ReasoningVisualizationService {
  constructor(
    @Optional()
    @InjectModel(ReasoningChain.name)
    private readonly chainModel?: Model<ReasoningChainDocument>,
    @Optional() private readonly lawyerExpertiseService?: LawyerExpertiseKnowledgeBaseService,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  // ===== 主入口：生成可视化图 =====

  /**
   * 根据推理链 ID 生成可视化图
   */
  async generateVisualization(
    reasoningChainId: string,
    config: VisualizationConfig = {},
  ): Promise<VisualizationGraph | null> {
    if (!this.chainModel) {
      throw new Error('ReasoningChain Model 未注入');
    }

    const chain = await this.chainModel.findOne({ chainId: reasoningChainId });
    if (!chain) {
      this.logger?.warn('推理链不存在', { reasoningChainId });
      return null;
    }

    // 根据配置生成不同的可视化类型
    const nodes: VisualizationNode[] = [];
    const edges: VisualizationEdge[] = [];

    // 1. 基础 IRAC 流程结构
    this.buildIracFlowchart(chain, nodes, edges);

    // 2. 律师专业判断应用
    if (config.includeExpertise !== false && chain.lawyerExpertiseApplied?.length) {
      this.buildExpertiseInfluence(chain, nodes, edges);
    }

    // 3. 推理追踪
    if (config.includeTrace !== false && chain.reasoningTrace?.length) {
      this.buildReasoningTrace(chain, nodes, edges);
    }

    // 4. 法条引用
    if (config.includeLawRefs !== false && chain.rules?.length) {
      this.buildLawReferenceMap(chain, nodes, edges);
    }

    return {
      type: 'irac_flowchart',
      title: 'IRAC 法律推理流程可视化',
      nodes,
      edges,
      metadata: {
        reasoningChainId,
        generatedAt: new Date(),
        expertiseAppliedCount: chain.lawyerExpertiseApplied?.length ?? 0,
        stepsCount: 4,
      },
    };
  }

  /**
   * 生成专业判断应用说明（人类可读格式）
   */
  async generateJudgmentExplanation(
    reasoningChainId: string,
  ): Promise<ProfessionalJudgmentExplanation | null> {
    if (!this.chainModel) throw new Error('ReasoningChain Model 未注入');

    const chain = await this.chainModel.findOne({ chainId: reasoningChainId });
    if (!chain) return null;

    const expertiseApplied = chain.lawyerExpertiseApplied ?? [];

    // v3.0：从知识库获取专业知识详情
    const expertiseDetails = new Map<string, string>();
    if (this.lawyerExpertiseService && expertiseApplied.length > 0) {
      try {
        const ids = [...new Set(expertiseApplied.map((e) => e.expertiseId))];
        for (const id of ids) {
          const detail = await this.lawyerExpertiseService.getById(id);
          if (detail) {
            expertiseDetails.set(id, detail.content ?? detail.title);
          }
        }
      } catch (err) {
        this.logger?.warn('获取专业知识详情失败', { error: String(err) });
      }
    }

    const stepMap = new Map<string, typeof expertiseApplied>();

    for (const item of expertiseApplied) {
      const existing = stepMap.get(item.iracStep) ?? [];
      existing.push(item);
      stepMap.set(item.iracStep, existing);
    }

    const stepLabels: Record<string, string> = {
      issue: '争议点识别 (Issue)',
      rule: '法条规则 (Rule)',
      application: '事实映射 (Application)',
      conclusion: '综合结论 (Conclusion)',
    };

    const stepByStepBreakdown = Array.from(stepMap.entries()).map(([step, items]) => ({
      step: stepLabels[step] ?? step,
      expertiseApplied: items.map((item) => ({
        expertiseId: item.expertiseId,
        title: item.expertiseTitle,
        type: item.expertiseType,
        applicationNote: item.applicationNote,
      })),
      influenceOnStep: items.map((i) => i.applicationNote).join('；'),
    }));

    const note = chain.professionalJudgmentNote;

    return {
      summary: note?.summary ?? `本次推理融合了 ${expertiseApplied.length} 条律师专业知识。`,
      stepByStepBreakdown,
      overallAssessment: note?.significantlyInfluenced
        ? '本次推理受到律师专业知识的显著影响，结论体现了资深律师的实务经验和专业判断。'
        : '本次推理参考了律师专业知识，但 AI 模型的基础推理逻辑仍为主导。',
    };
  }

  /**
   * 生成简洁摘要视图（用于列表展示）
   */
  async generateSummaryView(
    reasoningChainId: string,
  ): Promise<{
    reasoningChainId: string;
    iracSteps: Array<{ step: string; hasExpertise: boolean; expertiseCount: number }>;
    totalExpertiseApplied: number;
    keyInsights: string[];
  } | null> {
    if (!this.chainModel) throw new Error('ReasoningChain Model 未注入');

    const chain = await this.chainModel.findOne({ chainId: reasoningChainId });
    if (!chain) return null;

    const expertiseApplied = chain.lawyerExpertiseApplied ?? [];
    const stepOrder: Array<'issue' | 'rule' | 'application' | 'conclusion'> = [
      'issue',
      'rule',
      'application',
      'conclusion',
    ];

    const iracSteps = stepOrder.map((step) => {
      const items = expertiseApplied.filter((e) => e.iracStep === step);
      return {
        step,
        hasExpertise: items.length > 0,
        expertiseCount: items.length,
      };
    });

    // 提取关键洞察
    const keyInsights: string[] = [];
    const note = chain.professionalJudgmentNote;
    if (note?.summary) {
      keyInsights.push(note.summary);
    }
    if (note?.significantlyInfluenced) {
      keyInsights.push('律师专业知识对推理结果产生了显著影响');
    }

    return {
      reasoningChainId,
      iracSteps,
      totalExpertiseApplied: expertiseApplied.length,
      keyInsights,
    };
  }

  // ===== 私有构建方法 =====

  /**
   * 构建 IRAC 流程节点
   */
  private buildIracFlowchart(
    chain: ReasoningChainDocument,
    nodes: VisualizationNode[],
    edges: VisualizationEdge[],
  ): void {
    const iracSteps = [
      { key: 'issue', label: '争议点识别', icon: '⚖️' },
      { key: 'rule', label: '法条规则', icon: '📜' },
      { key: 'application', label: '事实映射', icon: '🔗' },
      { key: 'conclusion', label: '综合结论', icon: '💡' },
    ];

    // 创建节点
    for (let i = 0; i < iracSteps.length; i++) {
      const step = iracSteps[i];
      const nodeId = `irac_${step.key}`;

      nodes.push({
        id: nodeId,
        type: 'irac_step',
        label: `${step.icon} ${step.label}`,
        position: { x: 200, y: i * 150 + 50 },
        metadata: {
          step: step.key,
          issuesCount: chain.issues?.length ?? 0,
          rulesCount: chain.rules?.length ?? 0,
          hasExpertise:
            chain.lawyerExpertiseApplied?.some((e) => e.iracStep === step.key) ?? false,
        },
      });

      // 连接到前一步
      if (i > 0) {
        edges.push({
          id: `edge_irac_${iracSteps[i - 1].key}_to_${step.key}`,
          source: `irac_${iracSteps[i - 1].key}`,
          target: nodeId,
          type: 'flows',
          label: '推理流转',
        });
      }
    }
  }

  /**
   * 构建专业判断影响图
   */
  private buildExpertiseInfluence(
    chain: ReasoningChainDocument,
    nodes: VisualizationNode[],
    edges: VisualizationEdge[],
  ): void {
    const expertiseApplied = chain.lawyerExpertiseApplied ?? [];
    const iracStepLabels: Record<string, string> = {
      issue: '争议点识别',
      rule: '法条规则',
      application: '事实映射',
      conclusion: '综合结论',
    };

    for (const item of expertiseApplied) {
      const nodeId = `expertise_${item.expertiseId}`;

      // 避免重复节点
      if (nodes.some((n) => n.id === nodeId)) continue;

      nodes.push({
        id: nodeId,
        type: 'expertise',
        label: `📚 ${item.expertiseTitle}`,
        description: item.applicationNote,
        position: { x: 500, y: this.getStepYPosition(item.iracStep) },
        metadata: {
          expertiseId: item.expertiseId,
          expertiseType: item.expertiseType,
          iracStep: item.iracStep,
          influenceScore: item.influenceScore,
          source: item.source,
        },
      });

      // 连接到对应的 IRAC 步骤
      edges.push({
        id: `edge_influence_${item.expertiseId}_to_${item.iracStep}`,
        source: nodeId,
        target: `irac_${item.iracStep}`,
        type: 'influences',
        label: `影响${iracStepLabels[item.iracStep] ?? item.iracStep}`,
        weight: item.influenceScore,
      });
    }
  }

  /**
   * 构建推理追踪节点
   */
  private buildReasoningTrace(
    chain: ReasoningChainDocument,
    nodes: VisualizationNode[],
    edges: VisualizationEdge[],
  ): void {
    const trace = chain.reasoningTrace ?? [];

    for (const traceNode of trace) {
      const nodeId = `trace_${traceNode.nodeId}`;

      nodes.push({
        id: nodeId,
        type: 'trace',
        label: traceNode.title,
        description: traceNode.content,
        position: { x: 350, y: traceNode.order * 60 + 30 },
        metadata: {
          nodeType: traceNode.nodeType,
          order: traceNode.order,
          expertiseIds: traceNode.expertiseIds,
        },
      });

      // 连接到相关的专业知识节点
      for (const expId of traceNode.expertiseIds ?? []) {
        const expertiseNodeId = `expertise_${expId}`;
        if (nodes.some((n) => n.id === expertiseNodeId)) {
          edges.push({
            id: `edge_trace_${traceNode.nodeId}_to_${expId}`,
            source: nodeId,
            target: expertiseNodeId,
            type: 'supports',
            label: '应用记录',
          });
        }
      }
    }
  }

  /**
   * 构建法条引用关系
   */
  private buildLawReferenceMap(
    chain: ReasoningChainDocument,
    nodes: VisualizationNode[],
    edges: VisualizationEdge[],
  ): void {
    const rules = chain.rules ?? [];
    const applications = chain.applications ?? [];

    for (const rule of rules) {
      const nodeId = `rule_${rule.articleId.replace(/[^a-zA-Z0-9]/g, '_')}`;

      nodes.push({
        id: nodeId,
        type: 'rule',
        label: `📜 ${rule.articleId}`,
        description: rule.articleText?.slice(0, 100) ?? '',
        position: { x: 100, y: 450 + rules.indexOf(rule) * 80 },
        metadata: {
          articleId: rule.articleId,
          status: rule.status,
        },
      });

      // 连接到 IRAC Rule 步骤
      edges.push({
        id: `edge_rule_${rule.articleId}_to_rule_step`,
        source: nodeId,
        target: 'irac_rule',
        type: 'references',
        label: '适用',
      });
    }

    // Application 连接
    for (const app of applications) {
      const ruleNodeId = `rule_${app.ruleId.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const appNodeId = `app_${app.ruleId.replace(/[^a-zA-Z0-9]/g, '_')}`;

      nodes.push({
        id: appNodeId,
        type: 'application',
        label: `🔗 ${app.ruleId} 适用判定`,
        position: { x: 300, y: 500 + applications.indexOf(app) * 80 },
        metadata: {
          ruleId: app.ruleId,
          factMatch: app.factMatch,
          matchedFactsCount: app.matchedFacts?.length ?? 0,
        },
      });

      edges.push({
        id: `edge_app_${app.ruleId}_to_rule`,
        source: appNodeId,
        target: ruleNodeId,
        type: 'flows',
        label: app.factMatch,
      });

      edges.push({
        id: `edge_app_${app.ruleId}_to_application_step`,
        source: appNodeId,
        target: 'irac_application',
        type: 'references',
      });
    }
  }

  /**
   * 获取步骤的 Y 坐标
   */
  private getStepYPosition(step: string): number {
    const positions: Record<string, number> = {
      issue: 50,
      rule: 200,
      application: 350,
      conclusion: 500,
    };
    return positions[step] ?? 300;
  }
}
