/**
 * DocumentRecordService 单元测试（A3-W3）。
 *
 * 覆盖：
 *   - create：varsFilled L4 加密入库 + 返回 DTO（解密后）
 *   - findByDocId：查询 + 解密 varsFilled
 *   - findByUser：分页列表（不含敏感字段）
 *   - updateExport：回填 exportFileId + status=exported
 *   - deleteByDocId：删除记录
 *   - PiiService 强制注入：未注入时 create 抛错（拒绝明文降级）
 *   - 文书不存在抛 NotFoundException(2002)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { DocumentRecordService } from '../../src/modules/legal/document/document-record.service';
import type { LawRef } from '../../src/types/llm';

/** Mock Mongoose Model（链式调用） */
function makeModel() {
  const m = {
    create: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(),
    findOneAndUpdate: vi.fn(),
    deleteOne: vi.fn(),
    countDocuments: vi.fn(),
  };
  // 链式方法
  m.findOne.mockReturnValue({
    lean: () => ({
      exec: () => Promise.resolve(null),
    }),
    select: () => ({
      lean: () => ({
        exec: () => Promise.resolve(null),
      }),
    }),
  });
  m.find.mockReturnValue({
    sort: () => ({
      skip: () => ({
        limit: () => ({
          select: () => ({
            lean: () => ({
              exec: () => Promise.resolve([]),
            }),
          }),
        }),
      }),
    }),
  });
  m.findOneAndUpdate.mockReturnValue({
    lean: () => ({
      exec: () => Promise.resolve(null),
    }),
  });
  // countDocuments / deleteOne 返回带 exec 的链式对象
  m.countDocuments.mockReturnValue({
    exec: () => Promise.resolve(0),
  });
  m.deleteOne.mockReturnValue({
    exec: () => Promise.resolve({ deletedCount: 0 }),
  });
  return m;
}

function makePii() {
  return {
    encrypt: vi.fn((plain: string) => `ENC(${plain})`),
    decrypt: vi.fn((cipher: string) => cipher.replace(/^ENC\((.*)\)$/, '$1')),
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

const sampleLawRefs: LawRef[] = [
  { ref: '民法典第一百四十三条', verified: false },
  { ref: '民事诉讼法第一百一十九条', verified: false },
];

describe('DocumentRecordService', () => {
  let model: ReturnType<typeof makeModel>;
  let pii: ReturnType<typeof makePii>;
  let logger: ReturnType<typeof makeLogger>;
  let svc: DocumentRecordService;

  beforeEach(() => {
    model = makeModel();
    pii = makePii();
    logger = makeLogger();
    svc = new DocumentRecordService(model as never, pii as never, logger as never);
  });

  describe('create', () => {
    it('varsFilled L4 加密入库', async () => {
      const vars = { plaintiff: { name: '张三' } };
      const createdDoc = {
        docId: 'doc-1',
        userId: 'u1',
        templateCode: 'civil_complaint_v1',
        templateVersion: 1,
        varsFilled: `ENC(${JSON.stringify(vars)})`,
        renderedText: '正文',
        lawRefs: ['民法典第一百四十三条', '民事诉讼法第一百一十九条'],
        status: 'generated',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      model.create.mockResolvedValueOnce(createdDoc);

      const result = await svc.create({
        docId: 'doc-1',
        userId: 'u1',
        templateCode: 'civil_complaint_v1',
        varsFilled: vars,
        renderedText: '正文',
        lawRefs: sampleLawRefs,
      });

      expect(pii.encrypt).toHaveBeenCalledWith(JSON.stringify(vars));
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          docId: 'doc-1',
          varsFilled: `ENC(${JSON.stringify(vars)})`,
        }),
      );
      expect(result.varsFilled).toEqual(vars); // 解密后返回
      expect(result.lawRefs).toEqual(['民法典第一百四十三条', '民事诉讼法第一百一十九条']);
    });

    it('PiiService 未注入时拒绝明文降级（抛错，不静默写入明文）', async () => {
      const devSvc = new DocumentRecordService(model as never, undefined, logger as never);
      await expect(
        devSvc.create({
          docId: 'doc-1',
          userId: 'u1',
          templateCode: 'civil_complaint_v1',
          varsFilled: { a: 1 },
          renderedText: '正文',
          lawRefs: [],
        }),
      ).rejects.toThrow();
      // 明文降级路径已移除：不应写入数据库
      expect(model.create).not.toHaveBeenCalled();
    });
  });

  describe('findByDocId', () => {
    it('查询成功（解密 varsFilled）', async () => {
      const doc = {
        docId: 'doc-1',
        userId: 'u1',
        templateCode: 'civil_complaint_v1',
        templateVersion: 1,
        varsFilled: 'ENC({"name":"张三"})',
        renderedText: '正文',
        lawRefs: ['民法典第一百四十三条'],
        status: 'generated',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      model.findOne.mockReturnValueOnce({
        lean: () => ({ exec: () => Promise.resolve(doc) }),
      });

      const result = await svc.findByDocId('doc-1');
      expect(result.docId).toBe('doc-1');
      expect(result.varsFilled).toEqual({ name: '张三' });
    });

    it('不存在抛 NotFoundException(2002)', async () => {
      model.findOne.mockReturnValueOnce({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      });

      await expect(svc.findByDocId('no-such')).rejects.toThrow(NotFoundException);
      try {
        await svc.findByDocId('no-such');
      } catch (e) {
        const resp = (e as NotFoundException).getResponse() as { code: number };
        expect(resp.code).toBe(2002);
      }
    });
  });

  describe('findByUser', () => {
    it('分页查询用户文书列表', async () => {
      const items = [
        { docId: 'd1', templateCode: 't1', status: 'generated', createdAt: new Date() },
        { docId: 'd2', templateCode: 't2', status: 'exported', createdAt: new Date() },
      ];
      model.find.mockReturnValueOnce({
        sort: () => ({
          skip: () => ({
            limit: () => ({
              select: () => ({
                lean: () => ({ exec: () => Promise.resolve(items) }),
              }),
            }),
          }),
        }),
      });
      model.countDocuments.mockReturnValueOnce({
        exec: () => Promise.resolve(2),
      });

      const result = await svc.findByUser('u1', { page: 1, pageSize: 20 });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      // 列表项不应含 varsFilled / renderedText
      expect(result.items[0]).not.toHaveProperty('varsFilled');
      expect(result.items[0]).not.toHaveProperty('renderedText');
    });
  });

  describe('updateExport', () => {
    it('回填 exportFileId + status=exported', async () => {
      const updated = {
        docId: 'doc-1',
        userId: 'u1',
        templateCode: 't1',
        templateVersion: 1,
        varsFilled: 'ENC({})',
        renderedText: '正文',
        lawRefs: [],
        exportFileId: 'documents/doc-1/doc-1.docx',
        exportFormat: 'docx',
        status: 'exported',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      model.findOneAndUpdate.mockReturnValueOnce({
        lean: () => ({ exec: () => Promise.resolve(updated) }),
      });

      const result = await svc.updateExport('doc-1', 'documents/doc-1/doc-1.docx', 'docx');

      expect(result.exportFileId).toBe('documents/doc-1/doc-1.docx');
      expect(result.status).toBe('exported');
      expect(result.exportFormat).toBe('docx');
      expect(logger.info).toHaveBeenCalled();
    });

    it('不存在抛 NotFoundException(2002)', async () => {
      model.findOneAndUpdate.mockReturnValueOnce({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      });

      await expect(svc.updateExport('no-such', 'k', 'docx')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteByDocId', () => {
    it('删除成功', async () => {
      model.deleteOne.mockReturnValueOnce({
        exec: () => Promise.resolve({ deletedCount: 1 }),
      });
      await expect(svc.deleteByDocId('doc-1')).resolves.toBeUndefined();
    });

    it('不存在抛 NotFoundException(2002)', async () => {
      model.deleteOne.mockReturnValueOnce({
        exec: () => Promise.resolve({ deletedCount: 0 }),
      });
      await expect(svc.deleteByDocId('no-such')).rejects.toThrow(NotFoundException);
    });
  });

  describe('assertOwner', () => {
    it('所有者通过', async () => {
      model.findOne.mockReturnValueOnce({
        select: () => ({
          lean: () => ({ exec: () => Promise.resolve({ userId: 'u1' }) }),
        }),
      });
      await expect(svc.assertOwner('doc-1', 'u1')).resolves.toBeUndefined();
    });

    it('非所有者抛 NotFoundException(2002)', async () => {
      model.findOne.mockReturnValueOnce({
        select: () => ({
          lean: () => ({ exec: () => Promise.resolve({ userId: 'u1' }) }),
        }),
      });
      await expect(svc.assertOwner('doc-1', 'u2')).rejects.toThrow(NotFoundException);
      try {
        await svc.assertOwner('doc-1', 'u2');
      } catch (e) {
        const resp = (e as NotFoundException).getResponse() as { code: number };
        expect(resp.code).toBe(2002);
      }
    });

    it('admin 可查任意文书', async () => {
      model.findOne.mockReturnValueOnce({
        select: () => ({
          lean: () => ({ exec: () => Promise.resolve({ userId: 'u1' }) }),
        }),
      });
      await expect(svc.assertOwner('doc-1', 'u2', true)).resolves.toBeUndefined();
    });

    it('文书不存在抛 NotFoundException(2002)', async () => {
      model.findOne.mockReturnValueOnce({
        select: () => ({
          lean: () => ({ exec: () => Promise.resolve(null) }),
        }),
      });
      await expect(svc.assertOwner('no-such', 'u1')).rejects.toThrow(NotFoundException);
    });
  });
});
