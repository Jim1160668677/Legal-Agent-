/**
 * DocumentController 单元测试（A3-W3）。
 *
 * 覆盖：
 *   - GET /v1/documents/templates：列出模板
 *   - POST /v1/documents：同步生成（持久化）
 *   - POST /v1/documents/async：异步生成（返回 jobId）
 *   - GET /v1/documents/:docId：查询文书（含越权校验）
 *   - GET /v1/documents：列表
 *   - POST /v1/documents/:docId/export：导出
 *   - GET /v1/documents/:docId/download：下载 URL
 *   - 入参校验：templateCode 缺失抛 400
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DocumentController } from '../../src/modules/legal/document/document.controller';
import type { DocumentGenerateResult } from '../../src/modules/legal/document/document-generator.service';

function makeGenerator() {
  return {
    listTemplates: vi.fn(() => [{ code: 't1', title: 'T1', status: 'active' }]),
    generate: vi.fn(),
    generateAsync: vi.fn(),
  };
}

function makeRecordService() {
  return {
    create: vi.fn(),
    findByDocId: vi.fn(),
    findByUser: vi.fn(),
    updateExport: vi.fn(),
    deleteByDocId: vi.fn(),
    // assertOwner 默认放行（所有者/admin），非所有者场景由具体用例 mockRejectedValue
    assertOwner: vi.fn().mockResolvedValue(undefined),
  };
}

function makeExportService() {
  return {
    exportDocx: vi.fn(),
    exportPdf: vi.fn(),
    getDownloadUrl: vi.fn(),
  };
}

const mockUser = { sub: 'u1', role: 'user' };
const mockAdmin = { sub: 'admin1', role: 'admin' };

describe('DocumentController', () => {
  let generator: ReturnType<typeof makeGenerator>;
  let recordService: ReturnType<typeof makeRecordService>;
  let exportService: ReturnType<typeof makeExportService>;
  let controller: DocumentController;

  beforeEach(() => {
    generator = makeGenerator();
    recordService = makeRecordService();
    exportService = makeExportService();
    controller = new DocumentController(
      generator as never,
      recordService as never,
      exportService as never,
    );
  });

  describe('GET templates', () => {
    it('列出可用模板', () => {
      const result = controller.listTemplates();
      expect(result).toHaveLength(1);
      expect(generator.listTemplates).toHaveBeenCalled();
    });
  });

  describe('POST /  (同步生成)', () => {
    it('合法入参 → 持久化生成', async () => {
      const generated: DocumentGenerateResult = {
        docId: 'd1',
        templateCode: 't1',
        templateTitle: 'T1',
        renderedText: '正文',
        varsFilled: {},
        lawRefs: [],
        disclaimer: '免责',
        exportReady: true,
      };
      generator.generate.mockResolvedValueOnce(generated);

      const result = await controller.generate(
        { templateCode: 't1', vars: {} },
        mockUser as never,
        'case-1',
      );

      expect(generator.generate).toHaveBeenCalledWith(
        { templateCode: 't1', vars: {} },
        { userId: 'u1', caseId: 'case-1', persist: true },
      );
      expect(result.docId).toBe('d1');
    });

    it('templateCode 缺失抛 BadRequestException(1001)', async () => {
      await expect(
        controller.generate({ templateCode: '', vars: {} }, mockUser as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('body 为 null 抛 BadRequestException', async () => {
      await expect(controller.generate(null as never, mockUser as never)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('POST /async (异步生成)', () => {
    it('返回 jobId + status', async () => {
      generator.generateAsync.mockResolvedValueOnce({ jobId: 'j1', status: 'pending' });
      const result = await controller.generateAsync(
        { templateCode: 't1', vars: {} },
        mockUser as never,
      );
      expect(result.jobId).toBe('j1');
      expect(result.status).toBe('pending');
    });

    it('templateCode 缺失抛 BadRequestException', async () => {
      await expect(
        controller.generateAsync({ templateCode: '', vars: {} }, mockUser as never),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('GET /:docId', () => {
    it('所有者可查', async () => {
      recordService.findByDocId.mockResolvedValueOnce({
        docId: 'd1',
        userId: 'u1',
        templateCode: 't1',
      });
      const result = await controller.getDoc('d1', mockUser as never);
      expect(result.docId).toBe('d1');
      // 越权校验前置：assertOwner 被调用
      expect(recordService.assertOwner).toHaveBeenCalledWith('d1', 'u1', false);
    });

    it('非所有者抛 NotFoundException(2002)，且不触发 findByDocId 解密', async () => {
      recordService.assertOwner.mockRejectedValueOnce(
        new NotFoundException({ code: 2002, message: '文书不存在: d1' }),
      );
      await expect(controller.getDoc('d1', mockUser as never)).rejects.toThrow(NotFoundException);
      // 越权拦截后不应解密 varsFilled
      expect(recordService.findByDocId).not.toHaveBeenCalled();
    });

    it('admin 可查他人文书', async () => {
      recordService.findByDocId.mockResolvedValueOnce({
        docId: 'd1',
        userId: 'u2',
        templateCode: 't1',
      });
      const result = await controller.getDoc('d1', mockAdmin as never);
      expect(result.docId).toBe('d1');
      // admin 传入 isAdmin=true
      expect(recordService.assertOwner).toHaveBeenCalledWith('d1', 'admin1', true);
    });
  });

  describe('GET / (列表)', () => {
    it('分页查询', async () => {
      recordService.findByUser.mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
      const result = await controller.listMine(mockUser as never, '1', '20');
      expect(recordService.findByUser).toHaveBeenCalledWith('u1', { page: 1, pageSize: 20 });
      expect(result.total).toBe(0);
    });
  });

  describe('POST /:docId/export', () => {
    it('导出 docx（默认格式）', async () => {
      recordService.findByDocId.mockResolvedValueOnce({
        docId: 'd1',
        userId: 'u1',
        renderedText: '正文',
      });
      exportService.exportDocx.mockResolvedValueOnce({
        fileId: 'documents/d1/d1.docx',
        downloadUrl: 'memory://...',
        format: 'docx',
        size: 1000,
      });
      recordService.updateExport.mockResolvedValueOnce({});

      const result = await controller.exportDoc('d1', mockUser as never, { format: 'docx' });

      expect(exportService.exportDocx).toHaveBeenCalledWith('d1', '正文', undefined);
      expect(recordService.updateExport).toHaveBeenCalledWith('d1', 'documents/d1/d1.docx', 'docx');
      expect(result.format).toBe('docx');
    });

    it('导出 pdf', async () => {
      recordService.findByDocId.mockResolvedValueOnce({
        docId: 'd1',
        userId: 'u1',
        renderedText: '正文',
      });
      exportService.exportPdf.mockResolvedValueOnce({
        fileId: 'documents/d1/d1.pdf',
        downloadUrl: 'memory://...',
        format: 'pdf',
        size: 500,
      });
      recordService.updateExport.mockResolvedValueOnce({});

      const result = await controller.exportDoc('d1', mockUser as never, { format: 'pdf' });

      expect(exportService.exportPdf).toHaveBeenCalled();
      expect(result.format).toBe('pdf');
    });

    it('非所有者抛 NotFoundException，且不触发 findByDocId 解密', async () => {
      recordService.assertOwner.mockRejectedValueOnce(
        new NotFoundException({ code: 2002, message: '文书不存在: d1' }),
      );
      await expect(
        controller.exportDoc('d1', mockUser as never, { format: 'docx' }),
      ).rejects.toThrow(NotFoundException);
      expect(recordService.findByDocId).not.toHaveBeenCalled();
    });
  });

  describe('GET /:docId/download', () => {
    it('已导出文件 → 返回下载 URL', async () => {
      recordService.findByDocId.mockResolvedValueOnce({
        docId: 'd1',
        userId: 'u1',
        exportFileId: 'documents/d1/d1.docx',
      });
      exportService.getDownloadUrl.mockResolvedValueOnce('memory://signed-url');

      const result = await controller.getDownloadUrl('d1', mockUser as never);

      expect(exportService.getDownloadUrl).toHaveBeenCalledWith('documents/d1/d1.docx', 3600);
      expect(result.downloadUrl).toBe('memory://signed-url');
    });

    it('未导出文件抛 NotFoundException(3004)', async () => {
      recordService.findByDocId.mockResolvedValueOnce({
        docId: 'd1',
        userId: 'u1',
        exportFileId: undefined,
      });
      await expect(controller.getDownloadUrl('d1', mockUser as never)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
