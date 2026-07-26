/**
 * DocumentAgent 单元测试（A4-W2）。
 *
 * 覆盖：
 *   - capability 路由：document.generate / document.export
 *   - 同步生成：generator.generate → 返回 docId + renderedText
 *   - 异步生成：generator.generateAsync → 返回 jobId
 *   - 文书导出：exportService.exportDocx/exportPdf
 *   - 边界场景：缺 templateCode/docId/renderedText / 服务未注入
 *   - 模板方法：usage + 审计
 *
 * 设计依据：A4 §五 5.1 #5；A3 §4.4 DocumentGenerator。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentAgent } from '../../src/modules/legal/agents/document.agent';
import { DISCLAIMER_TEXT } from '../../src/modules/legal/chat/sse-frames';
import type { AgentContext, AgentInvokeInput } from '../../src/modules/legal/agents/types';
import type {
  DocumentGeneratorService,
  DocumentGenerateResult,
} from '../../src/modules/legal/document/document-generator.service';
import type {
  ExportService,
  ExportResult,
  ExportFormat,
} from '../../src/modules/legal/export/export.service';

function makeCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    traceId: 'trace-document-001',
    callerUserId: 'user-1',
    deadline: Date.now() + 10_000,
    lang: 'zh',
    ...overrides,
  };
}

function makeInput(overrides: Partial<AgentInvokeInput> = {}): AgentInvokeInput {
  return {
    capability: 'document.generate',
    params: {
      templateCode: 'civil_complaint_v1',
      vars: { plaintiff: '张某', defendant: '李某' },
    },
    piiLevel: 'L3',
    ...overrides,
  };
}

function makeGenerator(result?: Partial<DocumentGenerateResult>) {
  return {
    generate: vi.fn().mockResolvedValue({
      docId: 'doc-001',
      templateCode: 'civil_complaint_v1',
      templateTitle: '民事起诉状',
      renderedText: '原告：张某…被告：李某…',
      varsFilled: {},
      lawRefs: [{ ref: '民事诉讼法第一百一十九条', verified: false }],
      disclaimer: DISCLAIMER_TEXT,
      exportReady: true,
      ...result,
    }),
    generateAsync: vi.fn().mockResolvedValue({
      jobId: 'job-001',
      status: 'pending' as const,
    }),
    listTemplates: vi.fn(),
    getTemplate: vi.fn(),
    validateVars: vi.fn(),
    render: vi.fn(),
  };
}

function makeExportService(result?: Partial<ExportResult>) {
  return {
    exportDocx: vi.fn().mockResolvedValue({
      fileId: 'file-docx-001',
      downloadUrl: 'https://example.com/doc.docx',
      format: 'docx' as ExportFormat,
      size: 12345,
      ...result,
    }),
    exportPdf: vi.fn().mockResolvedValue({
      fileId: 'file-pdf-001',
      downloadUrl: 'https://example.com/doc.pdf',
      format: 'pdf' as ExportFormat,
      size: 23456,
      ...result,
    }),
    getDownloadUrl: vi.fn(),
  };
}

function makeAudit() {
  return { write: vi.fn(), writeSync: vi.fn() };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() };
}

describe('DocumentAgent', () => {
  let audit: ReturnType<typeof makeAudit>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    audit = makeAudit();
    logger = makeLogger();
  });

  describe('AgentCard', () => {
    it('card 字段：双 capability + L-Write-Limited + async', () => {
      const agent = new DocumentAgent(
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );
      expect(agent.card.agentId).toBe('document');
      expect(agent.card.capabilities).toEqual(['document.generate', 'document.export']);
      expect(agent.card.exposure).toBe('L-Write-Limited');
      expect(agent.card.async).toBe(true);
      expect(agent.card.piiLevel).toBe('L3');
      expect(agent.card.timeout).toBe(60_000);
    });
  });

  describe('document.generate 同步生成', () => {
    it('generator.generate → 返回 docId + renderedText', async () => {
      const generator = makeGenerator();
      const agent = new DocumentAgent(
        generator as unknown as DocumentGeneratorService,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(true);
      expect(result.data.docId).toBe('doc-001');
      expect(result.data.templateTitle).toBe('民事起诉状');
      expect(result.data.renderedText).toContain('张某');
      expect(result.data.exportReady).toBe(true);
      expect(result.lawRefs).toHaveLength(1);
      // generate 应被以正确的 dto + ctx 调用
      expect(generator.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          templateCode: 'civil_complaint_v1',
          vars: { plaintiff: '张某', defendant: '李某' },
        }),
        expect.objectContaining({ userId: 'user-1', persist: true }),
      );
    });

    it('audit.write 被调用 success', async () => {
      const generator = makeGenerator();
      const agent = new DocumentAgent(
        generator as unknown as DocumentGeneratorService,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      await agent.invoke(makeInput(), makeCtx());

      expect(audit.write).toHaveBeenCalledWith(
        'agent_invoke',
        expect.objectContaining({
          agentId: 'document',
          capability: 'document.generate',
          result: 'success',
        }),
      );
    });
  });

  describe('document.generate 异步生成', () => {
    it('async=true → 调用 generateAsync 返回 jobId', async () => {
      const generator = makeGenerator();
      const agent = new DocumentAgent(
        generator as unknown as DocumentGeneratorService,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({ params: { templateCode: 'civil_complaint_v1', vars: {}, async: true } }),
        makeCtx(),
      );

      expect(result.ok).toBe(true);
      expect(result.data.async).toBe(true);
      expect(result.data.jobId).toBe('job-001');
      expect(result.data.status).toBe('pending');
      expect(result.jobId).toBe('job-001');
      expect(generator.generateAsync).toHaveBeenCalled();
      expect(generator.generate).not.toHaveBeenCalled();
    });

    it('async 异步生成透传 userId 到 ctx', async () => {
      const generator = makeGenerator();
      const agent = new DocumentAgent(
        generator as unknown as DocumentGeneratorService,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      await agent.invoke(
        makeInput({ params: { templateCode: 't1', vars: {}, async: true } }),
        makeCtx({ callerUserId: 'user-99' }),
      );

      expect(generator.generateAsync).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ userId: 'user-99' }),
      );
    });
  });

  describe('document.export', () => {
    it('format=docx → 调用 exportDocx 返回 fileId + downloadUrl', async () => {
      const exportService = makeExportService();
      const agent = new DocumentAgent(
        undefined,
        exportService as unknown as ExportService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({
          capability: 'document.export',
          params: {
            docId: 'doc-001',
            renderedText: '原告：张某…',
            format: 'docx',
          },
        }),
        makeCtx(),
      );

      expect(result.ok).toBe(true);
      expect(result.data.docId).toBe('doc-001');
      expect(result.data.fileId).toBe('file-docx-001');
      expect(result.data.downloadUrl).toContain('doc.docx');
      expect(result.data.format).toBe('docx');
      expect(exportService.exportDocx).toHaveBeenCalledWith('doc-001', '原告：张某…', undefined);
    });

    it('format=pdf → 调用 exportPdf', async () => {
      const exportService = makeExportService();
      const agent = new DocumentAgent(
        undefined,
        exportService as unknown as ExportService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({
          capability: 'document.export',
          params: {
            docId: 'doc-002',
            renderedText: '原告：王某…',
            format: 'pdf',
            filename: 'wang.pdf',
          },
        }),
        makeCtx(),
      );

      expect(result.ok).toBe(true);
      expect(result.data.format).toBe('pdf');
      expect(exportService.exportPdf).toHaveBeenCalledWith('doc-002', '原告：王某…', 'wang.pdf');
    });

    it('format 未指定 → 默认 docx', async () => {
      const exportService = makeExportService();
      const agent = new DocumentAgent(
        undefined,
        exportService as unknown as ExportService,
        undefined,
        audit as never,
        logger as never,
      );

      await agent.invoke(
        makeInput({
          capability: 'document.export',
          params: { docId: 'doc-003', renderedText: 'x' },
        }),
        makeCtx(),
      );

      expect(exportService.exportDocx).toHaveBeenCalled();
      expect(exportService.exportPdf).not.toHaveBeenCalled();
    });
  });

  describe('边界场景', () => {
    it('document.generate 缺 templateCode → fail 1001', async () => {
      const generator = makeGenerator();
      const agent = new DocumentAgent(
        generator as unknown as DocumentGeneratorService,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({ params: { templateCode: '', vars: {} } }),
        makeCtx(),
      );

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(1001);
      expect(result.errorMessage).toContain('templateCode');
    });

    it('document.export 缺 docId → fail 1001', async () => {
      const exportService = makeExportService();
      const agent = new DocumentAgent(
        undefined,
        exportService as unknown as ExportService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({
          capability: 'document.export',
          params: { docId: '', renderedText: 'x' },
        }),
        makeCtx(),
      );

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(1001);
    });

    it('document.export 缺 renderedText → fail 1001', async () => {
      const exportService = makeExportService();
      const agent = new DocumentAgent(
        undefined,
        exportService as unknown as ExportService,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({
          capability: 'document.export',
          params: { docId: 'doc-004' },
        }),
        makeCtx(),
      );

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(1001);
      expect(result.errorMessage).toContain('renderedText');
    });

    it('document.generate + DocumentGenerator 未注入 → fail 5001', async () => {
      const agent = new DocumentAgent(
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(makeInput(), makeCtx());

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(5001);
    });

    it('document.export + ExportService 未注入 → fail 5001', async () => {
      const agent = new DocumentAgent(
        undefined,
        undefined,
        undefined,
        audit as never,
        logger as never,
      );

      const result = await agent.invoke(
        makeInput({
          capability: 'document.export',
          params: { docId: 'x', renderedText: 'y' },
        }),
        makeCtx(),
      );

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(5001);
    });
  });
});
