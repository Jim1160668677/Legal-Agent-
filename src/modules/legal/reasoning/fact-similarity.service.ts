/**
 * FactSimilarityService —— 案情事实相似度算法（v2.3-W5，16 §3）。
 *
 * 算法（16 §3.2）：
 *   similarity = embeddingWeight × cosSim + attributesWeight × jaccardSim
 *
 * 1. factEmbedding 相似度（默认权重 0.6）：
 *    - embA = EmbeddingService.embed(textA)
 *    - embB = EmbeddingService.embed(textB)
 *    - cosSim = cosine(embA, embB) ∈ [-1, 1] → 归一化到 [0, 1]：(cosSim + 1) / 2
 *
 * 2. factAttributes 相似度（默认权重 0.4）：
 *    - attrsA = extractAttributes(textA, entitiesA)
 *    - attrsB = attributesB（案例已有结构化属性）
 *    - jaccardSim = weightedJaccard(attrsA, attrsB)
 *      属性权重：causeOfAction 0.4 / partyRoles 0.2 / disputeAmount 0.2 / timeline 0.2
 *
 * 边界条件（16 §3.4）：
 *   - 文本过短（< 20 字）→ embedding 权重降至 0.3，attributes 升至 0.7
 *   - factB 无 structuredFields → attributes 降级为仅 causeOfAction（权重 1.0）
 *   - EmbeddingService 未注入或失败 → attributes 权重 1.0 + warnings
 *
 * 设计依据：16 §3 案情事实相似度算法；04 §1.12 FactSimilarityService。
 */
import { Injectable, Optional } from '@nestjs/common';
import { EmbeddingService } from '../embedding/embedding.service';
import { AppLoggerService } from '../../platform/logger/logger.service';
import type { Entity } from '../nlu/nlu.types';
import type { FactAttributes, FactSimilarityInput, FactSimilarityResult } from './reasoning.types';

/** 默认权重（16 §3.2） */
const DEFAULT_EMBEDDING_WEIGHT = 0.6;
const DEFAULT_ATTRIBUTES_WEIGHT = 0.4;
/** 文本过短降级权重（16 §3.4 第 1 条） */
const SHORT_TEXT_EMBEDDING_WEIGHT = 0.3;
const SHORT_TEXT_ATTRIBUTES_WEIGHT = 0.7;
/** 文本过短阈值（16 §3.4 第 1 条：< 20 字） */
const SHORT_TEXT_THRESHOLD = 20;

/** 属性权重（16 §3.2 第 2.d 步） */
const ATTRIBUTE_WEIGHTS: Required<{
  [K in keyof FactAttributes]: number;
}> = {
  causeOfAction: 0.4,
  partyRoles: 0.2,
  disputeAmount: 0.2,
  timeline: 0.2,
};

@Injectable()
export class FactSimilarityService {
  constructor(
    @Optional() private readonly embeddingService?: EmbeddingService,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  /**
   * 计算两份案情描述的相似度。
   * @returns FactSimilarityResult，similarity ∈ [0, 1]
   */
  async compute(input: FactSimilarityInput): Promise<FactSimilarityResult> {
    const { textA, entitiesA, textB, attributesB } = input;
    const warnings: string[] = [];

    // 1. 决定权重（边界条件：文本过短降级）
    const isShort = textA.length < SHORT_TEXT_THRESHOLD || textB.length < SHORT_TEXT_THRESHOLD;
    let embeddingWeight = isShort ? SHORT_TEXT_EMBEDDING_WEIGHT : DEFAULT_EMBEDDING_WEIGHT;
    let attributesWeight = isShort ? SHORT_TEXT_ATTRIBUTES_WEIGHT : DEFAULT_ATTRIBUTES_WEIGHT;

    if (isShort) {
      warnings.push('案情文本过短（< 20 字），embedding 权重降至 0.3');
    }

    // 2. 计算 embedding 相似度
    let cosSim = 0;
    let embeddingAvailable = false;
    if (this.embeddingService) {
      try {
        const [embA, embB] = await this.embeddingService.embedBatch([textA, textB]);
        if (embA && embB && embA.length === embB.length && embA.length > 0) {
          cosSim = this.cosine(embA, embB);
          embeddingAvailable = true;
        } else {
          warnings.push('embedding 返回维度不匹配或为空，降级为仅 attributes');
        }
      } catch (err) {
        warnings.push(
          `embedding 计算失败：${err instanceof Error ? err.message : String(err)}，降级为仅 attributes`,
        );
      }
    } else {
      warnings.push('EmbeddingService 未注入，降级为仅 attributes');
    }

    // 3. embedding 不可用时权重调整（16 §3.4 第 3 条）
    if (!embeddingAvailable) {
      embeddingWeight = 0;
      attributesWeight = 1.0;
    }

    // 归一化 cosSim 到 [0, 1]（16 §3.2 第 1.c 步）
    const normalizedCos = (cosSim + 1) / 2;

    // 4. 计算属性 Jaccard 相似度
    const attrsA = this.extractAttributes(textA, entitiesA);
    const { jaccardSim, attributeWarnings, attributeUsed } = this.weightedJaccard(
      attrsA,
      attributesB,
    );
    warnings.push(...attributeWarnings);

    // 5. 综合相似度
    const similarity = embeddingWeight * normalizedCos + attributesWeight * jaccardSim;

    // 边界保护：确保 ∈ [0, 1]
    const clampedSimilarity = Math.max(0, Math.min(1, similarity));

    this.logger?.debug('案情相似度计算完成', {
      similarity: clampedSimilarity,
      cosSim: normalizedCos,
      jaccardSim,
      embeddingWeight,
      attributesWeight,
      embeddingAvailable,
    });

    if (attributeUsed === 'causeOfAction_only' && !embeddingAvailable) {
      // 仅 causeOfAction + 无 embedding → 精度最低
      warnings.push('仅 causeOfAction 匹配 + 无 embedding，相似度精度较低');
    }

    return {
      similarity: clampedSimilarity,
      cosSim: normalizedCos,
      jaccardSim,
      embeddingWeight,
      attributesWeight,
      warnings,
    };
  }

  // ===== 内部辅助 =====

  /**
   * 从案情文本与实体中提取结构化属性（16 §3.2 第 2.a 步）。
   * 优先使用 entities（来自 nlu Agent），缺失时从文本关键词推断。
   */
  private extractAttributes(text: string, entities?: Entity[]): FactAttributes {
    const attrs: FactAttributes = {};

    if (entities && entities.length > 0) {
      // 案由：type='case_cause'
      const cause = entities.find((e) => e.type === 'case_cause');
      if (cause) attrs.causeOfAction = cause.value;

      // 当事人角色：type='person' 或 'org'
      const partyRoles = entities
        .filter((e) => e.type === 'person' || e.type === 'org')
        .map((e) => e.value);
      if (partyRoles.length > 0) attrs.partyRoles = partyRoles;

      // 争议金额：type='amount'
      const amount = entities.find((e) => e.type === 'amount');
      if (amount) attrs.disputeAmount = amount.value;

      // 时间线：type='date'
      const dates = entities.filter((e) => e.type === 'date').map((e) => e.value);
      if (dates.length > 0) attrs.timeline = dates.join('至');
    }

    // 兜底：从文本中提取金额（"X 元/万/百万"）
    if (!attrs.disputeAmount) {
      const amountMatch = text.match(/(\d+(?:\.\d+)?)\s*(元|万元|百万|千万|亿)/);
      if (amountMatch) {
        attrs.disputeAmount = `${amountMatch[1]}${amountMatch[2]}`;
      }
    }

    return attrs;
  }

  /**
   * 加权 Jaccard 相似度（16 §3.2 第 2.c-d 步）。
   *
   * 算法：仅计算两边都存在的属性，按权重加权平均。
   * 边界（16 §3.4 第 2 条）：factB 无 structuredFields → 仅 causeOfAction（权重 1.0）
   *
   * @returns { jaccardSim, attributeWarnings, attributeUsed }
   */
  private weightedJaccard(
    attrsA: FactAttributes,
    attrsB?: FactAttributes,
  ): {
    jaccardSim: number;
    attributeWarnings: string[];
    attributeUsed: 'all' | 'causeOfAction_only' | 'none';
  } {
    const warnings: string[] = [];

    if (!attrsB) {
      // factB 无 structuredFields → 降级为仅 causeOfAction（16 §3.4 第 2 条）
      warnings.push('factB 无 structuredFields，降级为仅 causeOfAction 匹配');
      if (!attrsA.causeOfAction) {
        return { jaccardSim: 0, attributeWarnings: warnings, attributeUsed: 'none' };
      }
      // causeOfAction 完全匹配（无 attrsB 时无法做精确匹配，返回 0.5 中性值）
      return { jaccardSim: 0.5, attributeWarnings: warnings, attributeUsed: 'causeOfAction_only' };
    }

    // 收集两边都存在的属性
    const commonKeys: (keyof FactAttributes)[] = [];
    for (const key of ['causeOfAction', 'partyRoles', 'disputeAmount', 'timeline'] as const) {
      if (attrsA[key] !== undefined && attrsB[key] !== undefined) {
        commonKeys.push(key);
      }
    }

    if (commonKeys.length === 0) {
      // 无共同属性 → 仅比较 causeOfAction（即使只有一方有）
      warnings.push('无共同属性维度，仅比较 causeOfAction');
      if (attrsA.causeOfAction && attrsB.causeOfAction) {
        const match = this.matchValue(attrsA.causeOfAction, attrsB.causeOfAction);
        return {
          jaccardSim: match ? 1.0 : 0,
          attributeWarnings: warnings,
          attributeUsed: 'causeOfAction_only',
        };
      }
      return { jaccardSim: 0, attributeWarnings: warnings, attributeUsed: 'none' };
    }

    // 仅 causeOfAction 共同时，使用权重 1.0（避免其他维度缺失影响）
    if (commonKeys.length === 1 && commonKeys[0] === 'causeOfAction') {
      const match = this.matchValue(attrsA.causeOfAction!, attrsB.causeOfAction!);
      return {
        jaccardSim: match ? 1.0 : 0,
        attributeWarnings: warnings,
        attributeUsed: 'causeOfAction_only',
      };
    }

    // 多维度加权平均
    let weightedSum = 0;
    let totalWeight = 0;
    for (const key of commonKeys) {
      const weight = ATTRIBUTE_WEIGHTS[key];
      const valA = attrsA[key];
      const valB = attrsB[key];
      const match = this.matchAttribute(key, valA, valB);
      weightedSum += weight * (match ? 1 : 0);
      totalWeight += weight;
    }

    const jaccardSim = totalWeight > 0 ? weightedSum / totalWeight : 0;
    return {
      jaccardSim,
      attributeWarnings: warnings,
      attributeUsed: 'all',
    };
  }

  /** 单值匹配（字符串包含/相等） */
  private matchValue(a: string, b: string): boolean {
    if (!a || !b) return false;
    const na = a.trim();
    const nb = b.trim();
    if (na === nb) return true;
    // 包含关系（处理"房屋买卖合同纠纷" vs "买卖合同纠纷"）
    return na.includes(nb) || nb.includes(na);
  }

  /** 属性匹配（按维度差异化判定） */
  private matchAttribute(key: keyof FactAttributes, valA: unknown, valB: unknown): boolean {
    if (valA === undefined || valB === undefined) return false;

    switch (key) {
      case 'causeOfAction':
        return this.matchValue(String(valA), String(valB));

      case 'partyRoles': {
        // 数组交集判定：至少一个共同角色
        const arrA = Array.isArray(valA) ? (valA as string[]) : [String(valA)];
        const arrB = Array.isArray(valB) ? (valB as string[]) : [String(valB)];
        return arrA.some((a) => arrB.some((b) => this.matchValue(a, b)));
      }

      case 'disputeAmount': {
        // 金额区间重叠判定：解析为数值，±50% 区间重叠
        const numA = this.parseAmount(String(valA));
        const numB = this.parseAmount(String(valB));
        if (numA === null || numB === null) return this.matchValue(String(valA), String(valB));
        const lower = Math.min(numA, numB) * 0.5;
        const upper = Math.max(numA, numB) * 1.5;
        return numA >= lower && numA <= upper && numB >= lower && numB <= upper;
      }

      case 'timeline': {
        // 时间线匹配：字符串包含
        return this.matchValue(String(valA), String(valB));
      }

      default:
        return false;
    }
  }

  /** 解析金额字符串为数值（"5万元" → 50000） */
  private parseAmount(s: string): number | null {
    const m = s.match(/(\d+(?:\.\d+)?)\s*(元|万元|百万|千万|亿)?/);
    if (!m) return null;
    const num = parseFloat(m[1]);
    const unit = m[2];
    switch (unit) {
      case '万元':
        return num * 10_000;
      case '百万':
        return num * 1_000_000;
      case '千万':
        return num * 10_000_000;
      case '亿':
        return num * 100_000_000;
      default:
        return num;
    }
  }

  /** 余弦相似度 */
  private cosine(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 0;
    return dot / denom;
  }
}
