/**
 * LawyerExpertiseKnowledgeBaseService —— 律师专业知识库管理服务（v3.0 新增）。
 *
 * 职责：
 *   1. CRUD：律师专业知识的创建、查询、更新、审核
 *   2. 智能检索：根据案件类型、应用场景、争议点等条件检索相关专业知识
 *   3. 知识融合：在 IRAC 推理各步骤中注入相关律师专业判断
 *   4. 使用追踪：记录专业知识的使用情况和效果评分
 *
 * 知识类型：
 *   - case_analysis：案例分析
 *   - argumentation_method：法律论证方法
 *   - practical_rule：实务经验规则
 *   - risk_assessment：风险判断要点
 *   - defense_strategy：辩护策略
 *
 * 设计依据：用户需求 1（结构化律师专业知识库）、需求 2（专业判断融合机制）。
 */
import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import {
  LawyerExpertise,
  type LawyerExpertiseDocument,
  type ExpertiseType,
  type ExpertiseScenario,
  type ExpertiseCondition,
  type ExpertiseArgument,
  type ExpertiseExample,
  type ExpertiseSource,
  type ExpertiseUsageRecord,
} from '../../../infra/database/schemas/lawyer-expertise.schema';
import { AppLoggerService } from '../../platform/logger/logger.service';

// ===== 类型定义 =====

/** 创建律师专业知识的输入 DTO */
export interface CreateExpertiseInput {
  expertiseType: ExpertiseType;
  title: string;
  content: string;
  scenarioTags: ExpertiseScenario[];
  conditions?: ExpertiseCondition;
  argument?: ExpertiseArgument;
  examples?: ExpertiseExample[];
  sources?: ExpertiseSource[];
  relatedLawIds?: string[];
  relatedCaseIds?: string[];
  contributedBy: string;
  contributorName?: string;
  practiceAreas?: string[];
}

/** 更新律师专业知识的输入 DTO */
export interface UpdateExpertiseInput {
  title?: string;
  content?: string;
  scenarioTags?: ExpertiseScenario[];
  conditions?: ExpertiseCondition;
  argument?: ExpertiseArgument;
  examples?: ExpertiseExample[];
  sources?: ExpertiseSource[];
  relatedLawIds?: string[];
  relatedCaseIds?: string[];
  practiceAreas?: string[];
  reviewStatus?: 'pending' | 'approved' | 'rejected';
  reviewNote?: string;
}

/** 检索参数 */
export interface ExpertiseQuery {
  /** 按知识类型过滤 */
  expertiseType?: ExpertiseType;
  /** 按应用场景过滤 */
  scenario?: ExpertiseScenario;
  /** 按争议点类型过滤 */
  issueType?: string;
  /** 按法律领域过滤 */
  practiceArea?: string;
  /** 关键词搜索（标题+内容） */
  keyword?: string;
  /** 关联法条 ID */
  lawId?: string;
  /** 最小可信度 */
  minReliability?: number;
  /** 审核状态 */
  reviewStatus?: 'pending' | 'approved' | 'rejected';
  /** 排序方式 */
  sortBy?: 'relevance' | 'usage' | 'reliability' | 'recent';
  /** 每页数量 */
  limit?: number;
  /** 分页 */
  page?: number;
}

/** 检索结果（用于返回给调用方的 DTO） */
export interface ExpertiseResult {
  expertiseId: string;
  expertiseType: string;
  title: string;
  content: string;
  scenarioTags: string[];
  conditions?: ExpertiseCondition;
  argument?: ExpertiseArgument;
  examples?: ExpertiseExample[];
  sources?: ExpertiseSource[];
  relatedLawIds?: string[];
  relatedCaseIds?: string[];
  contributedBy: string;
  contributorName?: string;
  practiceAreas?: string[];
  reliabilityScore: number;
  usageCount: number;
  reviewStatus: string;
  score?: number; // 检索相关度评分
}

/** 融合到推理步骤的上下文 */
export interface ExpertiseInjectionContext {
  /** 推理步骤 */
  iracStep: 'issue' | 'rule' | 'application' | 'conclusion';
  /** 争议点类型 */
  issueType?: string;
  /** 案件描述 */
  caseDescription?: string;
  /** 关联法条 ID */
  lawIds?: string[];
  /** 检索到的专业知识列表 */
  injectedExpertise: ExpertiseResult[];
  /** 注入给 LLM 的上下文文本 */
  injectionPrompt: string;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class LawyerExpertiseKnowledgeBaseService {
  constructor(
    @Optional()
    @InjectModel(LawyerExpertise.name)
    private readonly expertiseModel?: Model<LawyerExpertiseDocument>,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  // ===== CRUD 操作 =====

  /** 创建律师专业知识 */
  async create(input: CreateExpertiseInput): Promise<ExpertiseResult> {
    if (!this.expertiseModel) {
      throw new Error('LawyerExpertise model 未注入');
    }

    const expertiseId = `le_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const now = new Date();

    const doc = {
      expertiseId,
      expertiseType: input.expertiseType,
      title: input.title,
      content: input.content,
      scenarioTags: input.scenarioTags,
      conditions: input.conditions,
      argument: input.argument,
      examples: input.examples ?? [],
      sources: input.sources ?? [],
      relatedLawIds: input.relatedLawIds ?? [],
      relatedCaseIds: input.relatedCaseIds ?? [],
      contributedBy: input.contributedBy,
      contributorName: input.contributorName,
      practiceAreas: input.practiceAreas ?? [],
      reliabilityScore: 0.8,
      usageCount: 0,
      usageHistory: [],
      reviewStatus: 'approved',
      createdAt: now,
      updatedAt: now,
    };

    try {
      const saved = await this.expertiseModel.create(doc);
      this.logger?.info('律师专业知识创建成功', { expertiseId, type: input.expertiseType });
      return this.toResult(saved);
    } catch (err) {
      this.logger?.error('律师专业知识创建失败', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /** 按 ID 查询 */
  async getById(expertiseId: string): Promise<ExpertiseResult | null> {
    if (!this.expertiseModel || !expertiseId) return null;
    try {
      const doc = await this.expertiseModel
        .findOne({ expertiseId })
        .lean<LawyerExpertiseDocument>()
        .exec();
      return doc ? this.toResult(doc) : null;
    } catch (err) {
      this.logger?.warn('查询律师专业知识失败', {
        expertiseId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /** 按 ID 查询（别名，供外部模块调用） */
  async getByExpertiseId(expertiseId: string): Promise<ExpertiseResult | null> {
    return this.getById(expertiseId);
  }

  /** 更新律师专业知识 */
  async update(expertiseId: string, input: UpdateExpertiseInput): Promise<ExpertiseResult | null> {
    if (!this.expertiseModel) return null;
    try {
      const doc = await this.expertiseModel
        .findOneAndUpdate(
          { expertiseId },
          {
            $set: {
              ...(input.title && { title: input.title }),
              ...(input.content && { content: input.content }),
              ...(input.scenarioTags && { scenarioTags: input.scenarioTags }),
              ...(input.conditions && { conditions: input.conditions }),
              ...(input.argument && { argument: input.argument }),
              ...(input.examples && { examples: input.examples }),
              ...(input.sources && { sources: input.sources }),
              ...(input.relatedLawIds && { relatedLawIds: input.relatedLawIds }),
              ...(input.relatedCaseIds && { relatedCaseIds: input.relatedCaseIds }),
              ...(input.practiceAreas && { practiceAreas: input.practiceAreas }),
              ...(input.reviewStatus && { reviewStatus: input.reviewStatus }),
              ...(input.reviewNote && { reviewNote: input.reviewNote }),
              updatedAt: new Date(),
            },
          },
          { new: true },
        )
        .lean<LawyerExpertiseDocument>()
        .exec();

      if (doc) {
        this.logger?.info('律师专业知识更新成功', { expertiseId });
      }
      return doc ? this.toResult(doc) : null;
    } catch (err) {
      this.logger?.error('律师专业知识更新失败', {
        expertiseId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /** 删除律师专业知识（软删除，标记为 rejected） */
  async remove(expertiseId: string): Promise<boolean> {
    if (!this.expertiseModel) return false;
    try {
      const result = await this.expertiseModel
        .updateOne(
          { expertiseId },
          { $set: { reviewStatus: 'rejected', updatedAt: new Date() } },
        )
        .exec();
      return result.modifiedCount > 0;
    } catch (err) {
      this.logger?.error('律师专业知识删除失败', {
        expertiseId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  // ===== 智能检索 =====

  /**
   * 检索律师专业知识（核心检索方法）。
   * 支持按类型、场景、争议点、关键词等多维度过滤，返回按相关度排序的结果。
   */
  async query(params: ExpertiseQuery): Promise<{ items: ExpertiseResult[]; total: number }> {
    if (!this.expertiseModel) {
      return { items: [], total: 0 };
    }

    const page = Math.max(1, Math.floor(params.page ?? 1));
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(params.limit ?? DEFAULT_PAGE_SIZE)));
    const skip = (page - 1) * limit;

    // 构建过滤条件
    const filter: Record<string, unknown> = {};

    if (params.expertiseType) {
      filter.expertiseType = params.expertiseType;
    }
    if (params.scenario) {
      filter.scenarioTags = params.scenario;
    }
    if (params.issueType) {
      filter['conditions.issueTypes'] = params.issueType;
    }
    if (params.practiceArea) {
      filter.practiceAreas = params.practiceArea;
    }
    if (params.reviewStatus) {
      filter.reviewStatus = params.reviewStatus;
    } else {
      // 默认只返回已审核通过的
      filter.reviewStatus = 'approved';
    }
    if (params.minReliability) {
      filter.reliabilityScore = { $gte: params.minReliability };
    }
    if (params.lawId) {
      filter.relatedLawIds = params.lawId;
    }

    // 关键词搜索
    const keyword = params.keyword?.trim();
    if (keyword) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [{ title: regex }, { content: regex }];
    }

    // 排序
    const sortField = this.getSortField(params.sortBy ?? 'relevance');

    try {
      const [docs, total] = await Promise.all([
        this.expertiseModel
          .find(filter)
          .sort(sortField)
          .skip(skip)
          .limit(limit)
          .lean<LawyerExpertiseDocument[]>()
          .exec(),
        this.expertiseModel.countDocuments(filter).exec(),
      ]);

      const items = docs.map((doc) => this.toResult(doc, keyword));
      return { items, total };
    } catch (err) {
      this.logger?.warn('检索律师专业知识失败，降级返回空', {
        params,
        error: err instanceof Error ? err.message : String(err),
      });
      return { items: [], total: 0 };
    }
  }

  /**
   * 按场景和争议点检索相关专业知识（用于 IRAC 推理融合）。
   * 这是最常用的检索方法，根据当前推理的上下文自动匹配相关的律师专业判断。
   */
  async queryForScenario(
    scenario: ExpertiseScenario,
    issueType?: string,
    lawIds?: string[],
    limit = 5,
  ): Promise<ExpertiseResult[]> {
    const params: ExpertiseQuery = {
      scenario,
      reviewStatus: 'approved',
      sortBy: 'relevance',
      limit,
    };

    if (issueType) {
      params.issueType = issueType;
    }

    // 先按场景+争议点精确匹配
    const { items } = await this.query(params);

    // 如果结果不足，扩展检索
    if (items.length < limit && lawIds && lawIds.length > 0) {
      const { items: lawItems } = await this.query({
        lawId: lawIds[0],
        reviewStatus: 'approved',
        sortBy: 'relevance',
        limit: limit - items.length,
      });
      // 合并去重
      const existingIds = new Set(items.map((i) => i.expertiseId));
      for (const item of lawItems) {
        if (!existingIds.has(item.expertiseId)) {
          items.push(item);
          existingIds.add(item.expertiseId);
        }
      }
    }

    return items.slice(0, limit);
  }

  // ===== 知识融合（IRAC 推理注入）=====

  /**
   * 为 IRAC 推理的特定步骤生成专业知识注入上下文。
   * 根据当前步骤和案件特征，检索并格式化相关的律师专业判断，
   * 以便注入到 LLM 的 prompt 中。
   */
  async buildInjectionContext(
    iracStep: 'issue' | 'rule' | 'application' | 'conclusion',
    context: {
      issueType?: string;
      caseDescription?: string;
      lawIds?: string[];
      scenario?: ExpertiseScenario;
    },
  ): Promise<ExpertiseInjectionContext> {
    const scenario = context.scenario ?? this.inferScenario(context.issueType, context.caseDescription);
    const relevantTypes = this.getRelevantExpertiseTypes(iracStep);

    // 检索相关专业知识
    const allExpertise: ExpertiseResult[] = [];
    for (const type of relevantTypes) {
      const { items } = await this.query({
        expertiseType: type,
        scenario,
        issueType: context.issueType,
        lawId: context.lawIds?.[0],
        reviewStatus: 'approved',
        sortBy: 'relevance',
        limit: 3,
      });
      allExpertise.push(...items);
    }

    // 去重并限制总数
    const seen = new Set<string>();
    const uniqueExpertise = allExpertise.filter((e) => {
      if (seen.has(e.expertiseId)) return false;
      seen.add(e.expertiseId);
      return true;
    }).slice(0, 5);

    // 生成注入文本
    const injectionPrompt = this.formatExpertiseForPrompt(uniqueExpertise, iracStep);

    return {
      iracStep,
      issueType: context.issueType,
      caseDescription: context.caseDescription,
      lawIds: context.lawIds,
      injectedExpertise: uniqueExpertise,
      injectionPrompt,
    };
  }

  /**
   * 记录专业知识使用情况（用于效果追踪和可信度调整）。
   */
  async recordUsage(
    expertiseId: string,
    contextId: string,
    iracStep: string,
    effectivenessScore?: number,
  ): Promise<void> {
    if (!this.expertiseModel) return;

    const record: ExpertiseUsageRecord = {
      usedAt: new Date(),
      contextId,
      iracStep,
      effectivenessScore,
    };

    try {
      // 更新使用计数和历史
      const doc = await this.expertiseModel
        .findOneAndUpdate(
          { expertiseId },
          {
            $inc: { usageCount: 1 },
            $push: {
              usageHistory: {
                $each: [record],
                $slice: -100, // 保留最近 100 条记录
              },
            },
            $set: { updatedAt: new Date() },
          },
        )
        .exec();

      // 如果有效果评分，调整可信度
      if (effectivenessScore !== undefined && doc) {
        const newReliability = this.calculateNewReliability(
          doc.reliabilityScore ?? 0.8,
          effectivenessScore,
          doc.usageCount ?? 0,
        );
        await this.expertiseModel
          .updateOne(
            { expertiseId },
            { $set: { reliabilityScore: newReliability, updatedAt: new Date() } },
          )
          .exec();
      }
    } catch (err) {
      this.logger?.warn('记录律师专业知识使用情况失败', {
        expertiseId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 通过外部 ID 记录使用情况（用于审核场景等）。
   */
  async recordUsageByExternalId(
    expertiseId: string,
    externalId: string,
    source: string,
    effectivenessScore?: number,
  ): Promise<void> {
    if (!this.expertiseModel) return;

    const record: ExpertiseUsageRecord = {
      usedAt: new Date(),
      contextId: externalId,
      iracStep: source,
      effectivenessScore,
    };

    try {
      await this.expertiseModel
        .updateOne(
          { expertiseId },
          {
            $inc: { usageCount: 1 },
            $push: {
              usageHistory: {
                $each: [record],
                $slice: -100,
              },
            },
            $set: { updatedAt: new Date() },
          },
        )
        .exec();
    } catch (err) {
      this.logger?.warn('通过外部 ID 记录使用情况失败', {
        expertiseId,
        externalId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ===== 内部辅助方法 =====

  /** 文档转 DTO */
  private toResult(doc: LawyerExpertiseDocument, keyword?: string): ExpertiseResult {
    const result: ExpertiseResult = {
      expertiseId: doc.expertiseId,
      expertiseType: doc.expertiseType,
      title: doc.title,
      content: doc.content,
      scenarioTags: doc.scenarioTags ?? [],
      conditions: doc.conditions,
      argument: doc.argument,
      examples: doc.examples ?? [],
      sources: doc.sources ?? [],
      relatedLawIds: doc.relatedLawIds ?? [],
      relatedCaseIds: doc.relatedCaseIds ?? [],
      contributedBy: doc.contributedBy,
      contributorName: doc.contributorName,
      practiceAreas: doc.practiceAreas ?? [],
      reliabilityScore: doc.reliabilityScore ?? 0.8,
      usageCount: doc.usageCount ?? 0,
      reviewStatus: doc.reviewStatus ?? 'approved',
    };

    // 如果有关键词，计算简单相关度评分
    if (keyword) {
      const kw = keyword.toLowerCase();
      let score = 0;
      if (doc.title.toLowerCase().includes(kw)) score += 0.5;
      if (doc.content.toLowerCase().includes(kw)) score += 0.3;
      score += (doc.reliabilityScore ?? 0.8) * 0.2;
      result.score = Math.min(1, score);
    }

    return result;
  }

  /** 获取排序字段 */
  private getSortField(sortBy: string): Record<string, 1 | -1> {
    switch (sortBy) {
      case 'usage':
        return { usageCount: -1 };
      case 'reliability':
        return { reliabilityScore: -1 };
      case 'recent':
        return { createdAt: -1 };
      case 'relevance':
      default:
        return { reliabilityScore: -1, usageCount: -1 };
    }
  }

  /** 根据 IRAC 步骤获取相关的知识类型 */
  private getRelevantExpertiseTypes(step: string): ExpertiseType[] {
    const mapping: Record<string, ExpertiseType[]> = {
      issue: ['case_analysis', 'practical_rule'],
      rule: ['practical_rule', 'risk_assessment'],
      application: ['argumentation_method', 'practical_rule', 'risk_assessment'],
      conclusion: ['risk_assessment', 'defense_strategy', 'case_analysis'],
    };
    return mapping[step] ?? ['practical_rule'];
  }

  /** 推断应用场景 */
  private inferScenario(issueType?: string, caseDescription?: string): ExpertiseScenario {
    const text = `${issueType ?? ''} ${caseDescription ?? ''}`.toLowerCase();

    if (text.includes('合同') || text.includes('违约')) return 'contract_review';
    if (text.includes('风险') || text.includes('赔偿')) return 'risk_assessment';
    if (text.includes('诉讼') || text.includes('辩护')) return 'litigation_strategy';
    if (text.includes('审查') || text.includes('协议')) return 'document_review';
    return 'case_analysis';
  }

  /** 格式化专业知识为 prompt 上下文 */
  private formatExpertiseForPrompt(
    expertiseList: ExpertiseResult[],
    iracStep: string,
  ): string {
    if (expertiseList.length === 0) return '';

    const stepHints: Record<string, string> = {
      issue: '以下是资深律师在争议点识别方面的专业判断和案例经验，供您参考：',
      rule: '以下是资深律师在法条适用和规则理解方面的实务经验，供您参考：',
      application: '以下是资深律师在事实与法律适用方面的论证方法和经验规则，供您参考：',
      conclusion: '以下是资深律师在风险评估和结论撰写方面的专业判断，供您参考：',
    };

    const lines: string[] = [stepHints[iracStep] ?? '以下是资深律师的专业判断，供您参考：', ''];

    for (const exp of expertiseList) {
      lines.push(`【${exp.title}】（${exp.expertiseType}，可信度${(exp.reliabilityScore * 100).toFixed(0)}%）`);
      lines.push(exp.content);
      if (exp.examples && exp.examples.length > 0) {
        const example = exp.examples[0];
        lines.push(`典型案例：${example.title} - ${example.conclusion}`);
      }
      lines.push('');
    }

    lines.push('请结合以上律师专业判断，完成当前推理步骤。');
    return lines.join('\n');
  }

  /** 计算新的可信度评分（指数移动平均） */
  private calculateNewReliability(
    current: number,
    newScore: number,
    totalUsage: number,
  ): number {
    // EMA 平滑系数：使用次数越多，权重越小
    const alpha = Math.max(0.1, 2 / (totalUsage + 1));
    const newReliability = alpha * newScore + (1 - alpha) * current;
    // 限制在 [0, 1] 范围内
    return Math.min(1, Math.max(0, newReliability));
  }
}
