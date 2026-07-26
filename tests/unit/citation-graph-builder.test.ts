/**
 * CitationGraphBuilderService 单元测试（v2.3-W3，14 §十四）。
 *
 * 覆盖：
 *   1. 增量 upsert：case + document 两种记录类型
 *   2. 重复 upsert 幂等：同 recordId 不重复添加
 *   3. 全量重建：内存模式（mock caseModel/docModel）
 *   4. 查询：getGraph / getHotArticles
 *   5. 降级：空 citedLaws 跳过 / 单条失败跳过
 *   6. articleId 规范化（trim）
 *
 * 测试策略：不注入 Mongoose Model（@Optional），纯内存模式验证算法正确性。
 * DB 持久化由集成测试覆盖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CitationGraphBuilderService } from '../../src/modules/legal/knowledge/citation-graph-builder.service';

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    log: vi.fn(),
  };
}

/**
 * 构造 Mongoose chainable query mock：find().lean().exec() → Promise<T[]>。
 * 服务代码使用 `await model.find().lean().exec()` 链式调用，
 * 直接 mockResolvedValue 会在 `.lean()` 步骤抛 "lean is not a function"，
 * 该错误被外层 try-catch 吞掉导致 caseCount 始终为 0。
 */
function mockChainFind<T>(data: T[]): ReturnType<typeof vi.fn> {
  return vi.fn().mockReturnValue({
    lean: () => ({ exec: () => Promise.resolve(data) }),
  });
}

describe('v2.3-W3 CitationGraphBuilderService', () => {
  let service: CitationGraphBuilderService;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    // 不注入任何 Model，纯内存模式
    service = new CitationGraphBuilderService(undefined, undefined, undefined, logger as never);
  });

  describe('1. 增量 upsert', () => {
    it('case 记录 upsert 后 citingCaseIds 包含 recordId', async () => {
      const results = await service.upsertCitations(
        'case-001',
        ['民法典第143条', '民事诉讼法第121条'],
        'case',
      );
      expect(results).toHaveLength(2);
      expect(results[0].upserted).toBe(true);
      expect(results[0].citedCount).toBe(1);

      const graph = service.getGraph('民法典第143条');
      expect(graph).not.toBeNull();
      expect(graph!.citingCaseIds).toContain('case-001');
      expect(graph!.citingDocIds).toHaveLength(0);
      expect(graph!.citedCount).toBe(1);
    });

    it('document 记录 upsert 后 citingDocIds 包含 recordId', async () => {
      await service.upsertCitations('doc-001', ['民法典第143条'], 'document');
      const graph = service.getGraph('民法典第143条');
      expect(graph!.citingDocIds).toContain('doc-001');
      expect(graph!.citingCaseIds).toHaveLength(0);
      expect(graph!.citedCount).toBe(1);
    });

    it('case + document 混合引用时 citedCount 累加', async () => {
      await service.upsertCitations('case-001', ['民法典第143条'], 'case');
      await service.upsertCitations('case-002', ['民法典第143条'], 'case');
      await service.upsertCitations('doc-001', ['民法典第143条'], 'document');

      const graph = service.getGraph('民法典第143条');
      expect(graph!.citingCaseIds).toHaveLength(2);
      expect(graph!.citingDocIds).toHaveLength(1);
      expect(graph!.citedCount).toBe(3);
    });
  });

  describe('2. 重复 upsert 幂等', () => {
    it('同 recordId 多次 upsert 不重复添加', async () => {
      await service.upsertCitations('case-001', ['民法典第143条'], 'case');
      await service.upsertCitations('case-001', ['民法典第143条'], 'case');
      await service.upsertCitations('case-001', ['民法典第143条'], 'case');

      const graph = service.getGraph('民法典第143条');
      expect(graph!.citingCaseIds).toHaveLength(1);
      expect(graph!.citedCount).toBe(1);
    });
  });

  describe('3. 空值与降级', () => {
    it('空 citedLaws 返回空数组', async () => {
      const results = await service.upsertCitations('case-001', [], 'case');
      expect(results).toHaveLength(0);
    });

    it('空 recordId 返回空数组', async () => {
      const results = await service.upsertCitations('', ['民法典第143条'], 'case');
      expect(results).toHaveLength(0);
    });

    it('articleId 为空字符串跳过', async () => {
      const results = await service.upsertCitations(
        'case-001',
        ['', '  ', '民法典第143条'],
        'case',
      );
      expect(results).toHaveLength(1);
      expect(results[0].articleId).toBe('民法典第143条');
    });

    it('articleId trim 规范化', async () => {
      await service.upsertCitations('case-001', ['  民法典第143条  '], 'case');
      const graph = service.getGraph('民法典第143条');
      expect(graph).not.toBeNull();
      expect(graph!.articleId).toBe('民法典第143条');
    });
  });

  describe('4. 查询', () => {
    beforeEach(async () => {
      await service.upsertCitations('case-001', ['民法典第143条'], 'case');
      await service.upsertCitations('case-002', ['民法典第143条', '刑法第133条'], 'case');
      await service.upsertCitations('doc-001', ['刑法第133条'], 'document');
      await service.upsertCitations('doc-002', ['民事诉讼法第121条'], 'document');
    });

    it('getGraph 返回单条图谱', () => {
      const graph = service.getGraph('民法典第143条');
      expect(graph).not.toBeNull();
      expect(graph!.articleId).toBe('民法典第143条');
      expect(graph!.citingCaseIds).toHaveLength(2);
      expect(graph!.citedCount).toBe(2);
    });

    it('getGraph 未命中返回 null', () => {
      const graph = service.getGraph('不存在的法条');
      expect(graph).toBeNull();
    });

    it('getHotArticles 按 citedCount 降序', () => {
      const hot = service.getHotArticles(10);
      expect(hot).toHaveLength(3);
      // 民法典第143条 citedCount=2，刑法第133条 citedCount=2（case+doc），民事诉讼法第121条 citedCount=1
      expect(hot[0].citedCount).toBeGreaterThanOrEqual(hot[1].citedCount);
      expect(hot[1].citedCount).toBeGreaterThanOrEqual(hot[2].citedCount);
    });

    it('getHotArticles topK 限制', () => {
      const hot = service.getHotArticles(2);
      expect(hot).toHaveLength(2);
    });

    it('getHotArticles 默认 topK=10', () => {
      const hot = service.getHotArticles();
      expect(hot.length).toBeLessThanOrEqual(10);
    });
  });

  describe('5. 全量重建（内存模式）', () => {
    it('rebuildAll 从 case_precedent + document_record 提取并重建', async () => {
      // mock caseModel / docModel，支持 find().lean().exec() 链式调用
      // 注：content/renderedText 中法条引用须置于句首（前面无汉字），
      //     否则 extractLawRefs 正则会将前缀汉字（如"依据"/"引用"）并入 lawName。
      const mockCaseModel = {
        find: mockChainFind([
          {
            _id: 'case-001',
            contentHash: 'case-001',
            content: '民法典第143条，被告应承担民事责任。民事诉讼法第121条。',
          },
          {
            _id: 'case-002',
            contentHash: 'case-002',
            content: '刑法第133条定罪量刑。',
          },
        ]),
      };
      const mockDocModel = {
        find: mockChainFind([
          {
            docId: 'doc-001',
            lawRefs: ['民法典第143条', '民法典第509条'],
            renderedText: '',
          },
          {
            docId: 'doc-002',
            lawRefs: [],
            renderedText: '民事诉讼法第121条起诉',
          },
        ]),
      };
      const svc = new CitationGraphBuilderService(
        undefined,
        mockCaseModel as never,
        mockDocModel as never,
        logger as never,
      );

      const stats = await svc.rebuildAll();

      expect(stats.caseCount).toBe(2);
      expect(stats.docCount).toBe(2);
      expect(stats.articleCount).toBe(4); // 民法典143/民诉121/刑法133/民法典509
      expect(stats.errors).toBe(0);
      expect(stats.durationMs).toBeGreaterThanOrEqual(0);

      // 验证图谱内容
      const g1 = svc.getGraph('民法典第143条');
      expect(g1).not.toBeNull();
      expect(g1!.citingCaseIds).toContain('case-001');
      expect(g1!.citingDocIds).toContain('doc-001');
      expect(g1!.citedCount).toBe(2);

      const g2 = svc.getGraph('刑法第133条');
      expect(g2!.citingCaseIds).toContain('case-002');
      expect(g2!.citedCount).toBe(1);
    });

    it('rebuildAll 清空旧图谱', async () => {
      // 先 upsert 一些数据
      await service.upsertCitations('old-case', ['旧法条第1条'], 'case');
      expect(service.size).toBe(1);

      // 无 Model 时 rebuildAll 清空图谱
      const stats = await service.rebuildAll();
      expect(stats.caseCount).toBe(0);
      expect(stats.docCount).toBe(0);
      expect(stats.articleCount).toBe(0);
      expect(service.size).toBe(0);
    });

    it('rebuildAll 跳过无 content 的案例', async () => {
      const mockCaseModel = {
        find: mockChainFind([
          { _id: 'case-001', contentHash: 'case-001', content: '' },
          { _id: 'case-002', contentHash: 'case-002', content: '民法典第143条' },
        ]),
      };
      const svc = new CitationGraphBuilderService(
        undefined,
        mockCaseModel as never,
        undefined,
        logger as never,
      );

      const stats = await svc.rebuildAll();
      expect(stats.caseCount).toBe(1); // case-001 content 为空跳过
      expect(stats.articleCount).toBe(1);
    });
  });

  describe('6. size 与 clearForTesting', () => {
    it('size 返回图谱条目数', async () => {
      expect(service.size).toBe(0);
      await service.upsertCitations('case-001', ['法条1', '法条2', '法条3'], 'case');
      expect(service.size).toBe(3);
    });

    it('clearForTesting 清空图谱', async () => {
      await service.upsertCitations('case-001', ['法条1'], 'case');
      expect(service.size).toBe(1);
      service.clearForTesting();
      expect(service.size).toBe(0);
    });
  });

  describe('7. 元数据', () => {
    it('lastCitedAt 和 updatedAt 在 upsert 时更新', async () => {
      const before = new Date();
      await service.upsertCitations('case-001', ['民法典第143条'], 'case');
      const graph = service.getGraph('民法典第143条');
      expect(graph!.lastCitedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(graph!.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('多次 upsert 后 lastCitedAt 取最新', async () => {
      await service.upsertCitations('case-001', ['民法典第143条'], 'case');
      const t1 = service.getGraph('民法典第143条')!.lastCitedAt;

      // 等待一小段时间确保时间不同
      await new Promise((r) => setTimeout(r, 10));

      await service.upsertCitations('case-002', ['民法典第143条'], 'case');
      const t2 = service.getGraph('民法典第143条')!.lastCitedAt;

      expect(t2.getTime()).toBeGreaterThanOrEqual(t1.getTime());
    });
  });
});
