/**
 * CaseComparatorService —— 案例对比算法（v2.3-W5，16 §5）。
 *
 * 算法（16 §5.2）：
 *   输入：userFacts（用户案情 + 实体）+ cases[]（候选案例，缺失时 RagService 召回 case_precedent top 3）
 *   输出：comparison[] = { caseId, similarity, sharedFacts[], diffFacts[], verdictDiff }
 *
 *   1. for case in cases:
 *      1.1 similarity = FactSimilarityService.compute(userFacts, case)
 *      1.2 if similarity < 0.5: 跳过（不相似，16 §3.3）
 *      1.3 差异点抽取：
 *          a. sharedFacts：用户事实与案例事实的交集（相同案由/争议类型/当事人角色）
 *          b. diffFacts：用户事实与案例事实的差集（不同争议金额/时间线/判决结果）
 *          c. verdictDiff：案例判决结果 vs 用户预期（若用户提供预期）
 *      1.4 comparison.push({ caseId, similarity, sharedFacts, diffFacts, verdictDiff })
 *   2. 按 similarity 降序排列
 *   3. 返回 comparison[]
 *
 * 降级（16 §7）：
 *   - 无相似案例（similarity < 0.5）→ 空 comparison[] + 引导提示
 *   - FactSimilarityService 未注入 → 跳过相似度计算，所有案例都纳入对比（similarity=0）
 *
 * 设计依据：16 §5 案例对比；07 §9.4；04 §1.12 CaseComparator。
 */
import { Injectable, Optional } from '@nestjs/common';
import { RagService } from '../retrieval/rag.service';
import { AppLoggerService } from '../../platform/logger/logger.service';
import type { Entity } from '../nlu/nlu.types';
import { FactSimilarityService } from './fact-similarity.service';
import type {
  CaseCompareInput,
  CaseCompareResult,
  CaseComparison,
  FactAttributes,
} from './reasoning.types';
import { SIMILARITY_THRESHOLDS } from './reasoning.types';

/** 候选案例内部表示 */
interface CandidateCase {
  caseId: string;
  caseTitle?: string;
  content: string;
  causeOfAction?: string;
  category?: string;
  outcomeLabel?: string;
  keywords?: string[];
}

/** 默认召回案例数（16 §5.2：top 3） */
const DEFAULT_RECALL_TOP_K = 3;

@Injectable()
export class CaseComparatorService {
  constructor(
    @Optional() private readonly factSimilarity?: FactSimilarityService,
    @Optional() private readonly rag?: RagService,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  /**
   * 案例对比。
   * @returns CaseCompareResult，含 comparison[] 与 totalCases
   */
  async compare(input: CaseCompareInput): Promise<CaseCompareResult> {
    const { userFacts } = input;
    const warnings: string[] = [];

    // 1. 获取候选案例（外部传入优先，否则 RagService 召回）
    let cases: CandidateCase[] = [];
    if (input.cases && input.cases.length > 0) {
      cases = input.cases;
    } else if (this.rag) {
      try {
        cases = await this.recallCases(userFacts.text);
        if (cases.length === 0) {
          warnings.push('RagService 召回案例为空');
        }
      } catch (err) {
        warnings.push(
          `RagService 召回案例失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      warnings.push('RagService 未注入且未提供候选案例，无法对比');
      return {
        comparison: [],
        totalCases: 0,
        warnings,
      };
    }

    if (cases.length === 0) {
      return {
        comparison: [],
        totalCases: 0,
        warnings: [...warnings, '暂无相似案例，建议咨询专业律师'],
      };
    }

    // 2. 逐案例对比
    const comparison: CaseComparison[] = [];
    for (const c of cases) {
      const attributesB = this.extractCaseAttributes(c);

      let similarity = 0;
      if (this.factSimilarity) {
        try {
          const simResult = await this.factSimilarity.compute({
            textA: userFacts.text,
            entitiesA: userFacts.entities,
            textB: c.content,
            attributesB,
          });
          similarity = simResult.similarity;
        } catch (err) {
          warnings.push(
            `案例 ${c.caseId} 相似度计算失败：${err instanceof Error ? err.message : String(err)}`,
          );
          continue;
        }
      } else {
        // FactSimilarityService 未注入 → 简化匹配（causeOfAction 相同则 0.6，否则 0.3）
        similarity = this.simpleSimilarity(userFacts, c);
        warnings.push('FactSimilarityService 未注入，使用简化相似度');
      }

      // 16 §3.3：< 0.5 不相似，跳过
      if (similarity < SIMILARITY_THRESHOLDS.WEAK) {
        continue;
      }

      // 差异点抽取（16 §5.2 第 1.3 步）
      const sharedFacts = this.extractSharedFacts(userFacts, c, attributesB);
      const diffFacts = this.extractDiffFacts(userFacts, c, attributesB);
      const verdictDiff = this.extractVerdictDiff(c.outcomeLabel, userFacts.expectedVerdict);

      comparison.push({
        caseId: c.caseId,
        caseTitle: c.caseTitle,
        similarity,
        sharedFacts,
        diffFacts,
        verdictDiff,
        outcomeLabel: c.outcomeLabel,
      });
    }

    // 3. 按 similarity 降序（16 §5.2 第 2 步）
    comparison.sort((a, b) => b.similarity - a.similarity);

    if (comparison.length === 0) {
      warnings.push('暂无高度相似案例（相似度均 < 0.5），建议咨询专业律师');
    }

    this.logger?.debug('案例对比完成', {
      totalCases: cases.length,
      matchedCases: comparison.length,
      topSimilarity: comparison[0]?.similarity ?? 0,
    });

    return {
      comparison,
      totalCases: cases.length,
      warnings,
    };
  }

  // ===== 内部辅助 =====

  /** 通过 RagService 召回 case_precedent top 3 */
  private async recallCases(queryText: string): Promise<CandidateCase[]> {
    if (!this.rag) return [];
    const results = await this.rag.retrieve({
      text: queryText,
      collections: ['case_precedent'],
      finalTopK: DEFAULT_RECALL_TOP_K,
    });
    return results.map((r) => ({
      caseId: r.id,
      caseTitle: r.title,
      content: r.content,
      causeOfAction: (r.meta?.causeOfAction as string) ?? undefined,
      category: (r.meta?.category as string) ?? undefined,
      outcomeLabel: (r.meta?.outcomeLabel as string) ?? undefined,
      keywords: Array.isArray(r.meta?.keywords) ? (r.meta!.keywords as string[]) : undefined,
    }));
  }

  /** 从案例中提取结构化属性（FactSimilarityService 入参 attributesB） */
  private extractCaseAttributes(c: CandidateCase): FactAttributes {
    const attrs: FactAttributes = {};
    if (c.causeOfAction) attrs.causeOfAction = c.causeOfAction;
    if (c.keywords && c.keywords.length > 0) {
      // keywords 中可能含当事人角色关键词
      const roleKeywords = c.keywords.filter((k) =>
        /原告|被告|甲方|乙方|第三人|上诉人|被上诉人/.test(k),
      );
      if (roleKeywords.length > 0) attrs.partyRoles = roleKeywords;
    }
    // 从 content 中提取金额
    const amountMatch = c.content.match(/(\d+(?:\.\d+)?)\s*(元|万元|百万|千万|亿)/);
    if (amountMatch) attrs.disputeAmount = `${amountMatch[1]}${amountMatch[2]}`;
    // 从 content 中提取日期（简化：取第一个日期作为时间线）
    const dateMatch = c.content.match(/\d{4}年\d{1,2}月\d{1,2}日/);
    if (dateMatch) attrs.timeline = dateMatch[0];
    return attrs;
  }

  /**
   * 共同事实抽取（16 §5.2 第 1.3.a 步）。
   * 交集：相同案由/相同争议类型/相似当事人角色
   */
  private extractSharedFacts(
    userFacts: { text: string; entities?: Entity[] },
    c: CandidateCase,
    attrsB: FactAttributes,
  ): string[] {
    const shared: string[] = [];

    // 案由匹配
    const userCause = userFacts.entities?.find((e) => e.type === 'case_cause')?.value;
    if (userCause && attrsB.causeOfAction) {
      if (this.valueMatch(userCause, attrsB.causeOfAction)) {
        shared.push(`案由：${attrsB.causeOfAction}`);
      }
    }

    // 类别匹配（民事/刑事/商事/行政）
    if (c.category) {
      const userCategoryMatch = userFacts.text.match(/民事|刑事|商事|行政/);
      if (userCategoryMatch && userCategoryMatch[0] === c.category) {
        shared.push(`案件类别：${c.category}`);
      }
    }

    // 当事人角色匹配
    const userRoles = userFacts.entities
      ?.filter((e) => e.type === 'person' || e.type === 'org')
      .map((e) => e.value);
    if (userRoles && attrsB.partyRoles) {
      const common = userRoles.filter((r) =>
        attrsB.partyRoles!.some((br) => this.valueMatch(r, br)),
      );
      if (common.length > 0) {
        shared.push(`当事人角色：${common.join('、')}`);
      }
    }

    return shared;
  }

  /**
   * 差异点抽取（16 §5.2 第 1.3.b 步）。
   * 差集：不同争议金额/不同时间线/不同判决结果
   */
  private extractDiffFacts(
    userFacts: { text: string; entities?: Entity[]; expectedVerdict?: string },
    c: CandidateCase,
    attrsB: FactAttributes,
  ): string[] {
    const diff: string[] = [];

    // 争议金额差异
    const userAmount = userFacts.entities?.find((e) => e.type === 'amount')?.value;
    if (userAmount && attrsB.disputeAmount && userAmount !== attrsB.disputeAmount) {
      diff.push(`争议金额：用户 ${userAmount} vs 案例 ${attrsB.disputeAmount}`);
    }

    // 时间线差异
    const userDates = userFacts.entities?.filter((e) => e.type === 'date').map((e) => e.value);
    if (userDates && userDates.length > 0 && attrsB.timeline) {
      const userTimeline = userDates.join('至');
      if (!this.valueMatch(userTimeline, attrsB.timeline)) {
        diff.push(`时间线：用户 ${userTimeline} vs 案例 ${attrsB.timeline}`);
      }
    }

    // 判决结果差异（用户预期 vs 案例实际）
    if (userFacts.expectedVerdict && c.outcomeLabel) {
      if (!this.valueMatch(userFacts.expectedVerdict, c.outcomeLabel)) {
        diff.push(`判决结果：用户预期 ${userFacts.expectedVerdict} vs 案例判决 ${c.outcomeLabel}`);
      }
    }

    return diff;
  }

  /** 判决结果差异（16 §5.2 第 1.3.c 步，单独字段） */
  private extractVerdictDiff(caseOutcomeLabel?: string, userExpected?: string): string | undefined {
    if (!caseOutcomeLabel || !userExpected) return undefined;
    if (this.valueMatch(userExpected, caseOutcomeLabel)) {
      return `案例判决与用户预期一致：${caseOutcomeLabel}`;
    }
    return `案例判决（${caseOutcomeLabel}）与用户预期（${userExpected}）不一致`;
  }

  /**
   * 简化相似度（FactSimilarityService 未注入时的降级）。
   * - causeOfAction 相同 → 0.6
   * - category 相同 → 0.5
   * - 否则 → 0.3
   */
  private simpleSimilarity(
    userFacts: { text: string; entities?: Entity[] },
    c: CandidateCase,
  ): number {
    const userCause = userFacts.entities?.find((e) => e.type === 'case_cause')?.value;
    if (userCause && c.causeOfAction && this.valueMatch(userCause, c.causeOfAction)) {
      return 0.6;
    }
    if (c.category) {
      const userCategoryMatch = userFacts.text.match(/民事|刑事|商事|行政/);
      if (userCategoryMatch && userCategoryMatch[0] === c.category) {
        return 0.5;
      }
    }
    return 0.3;
  }

  /** 值匹配（包含关系） */
  private valueMatch(a: string, b: string): boolean {
    if (!a || !b) return false;
    const na = a.trim();
    const nb = b.trim();
    if (na === nb) return true;
    return na.includes(nb) || nb.includes(na);
  }
}
