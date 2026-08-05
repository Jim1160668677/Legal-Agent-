/**
 * sse-frames 单元测试（A1-W4 SSE 帧序列规范）。
 *
 * 覆盖：
 *   - writeSseFrame 帧格式 `data: <json>\n\n`
 *   - initSseResponse 设置 Content-Type/Cache-Control/Connection/X-Accel-Buffering
 *   - writeSseClosing 帧序 meta → disclaimer → done 且结尾
 *
 * 设计依据：A1 §十 SSE 帧序列；03 §四 免责声明。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  SSE_CONTENT_TYPE,
  DISCLAIMER_TEXT,
  writeSseFrame,
  initSseResponse,
  writeSseClosing,
} from '../../src/modules/legal/chat/sse-frames';

function makeRes() {
  return {
    setHeader: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    flushHeaders: vi.fn(),
  };
}

describe('writeSseFrame', () => {
  it('chunk 帧 → `data: <json>\\n\\n`', () => {
    const res = makeRes();
    writeSseFrame(res as never, { type: 'chunk', delta: '你好' });
    expect(res.write).toHaveBeenCalledWith('data: {"type":"chunk","delta":"你好"}\n\n');
  });

  it('done 帧携带 traceId', () => {
    const res = makeRes();
    writeSseFrame(res as never, { type: 'done', traceId: 'tr-1' });
    expect(res.write).toHaveBeenCalledWith('data: {"type":"done","traceId":"tr-1"}\n\n');
  });

  it('error 帧携带 code/message', () => {
    const res = makeRes();
    writeSseFrame(res as never, { type: 'error', code: 5003, message: '降级' });
    expect(res.write).toHaveBeenCalledWith('data: {"type":"error","code":5003,"message":"降级"}\n\n');
  });
});

describe('initSseResponse', () => {
  it('设置 SSE 四件套响应头并 flush', () => {
    const res = makeRes();
    initSseResponse(res as never);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', SSE_CONTENT_TYPE);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache, no-transform');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    expect(res.flushHeaders).toHaveBeenCalled();
  });

  it('flushHeaders 不存在时不抛错', () => {
    const res = { setHeader: vi.fn() };
    expect(() => initSseResponse(res as never)).not.toThrow();
  });
});

describe('writeSseClosing', () => {
  it('帧序 meta → disclaimer → done → end', () => {
    const res = makeRes();
    const meta = {
      type: 'meta',
      intent: 'rule_query',
      route: 'rule',
      source: 'rule',
      lawRefs: [],
    } as const;
    writeSseClosing(res as never, meta, 'tr-9');

    const writes = res.write.mock.calls.map((c: string[]) => c[0]);
    expect(writes).toHaveLength(3);
    expect(writes[0]).toContain('"type":"meta"');
    expect(writes[1]).toBe(`data: {"type":"disclaimer","text":"${DISCLAIMER_TEXT}"}\n\n`);
    expect(writes[2]).toBe('data: {"type":"done","traceId":"tr-9"}\n\n');
    expect(res.end).toHaveBeenCalled();
  });

  it('DISCLAIMER_TEXT 含法律合规要点', () => {
    expect(DISCLAIMER_TEXT).toContain('不构成法律意见');
    expect(DISCLAIMER_TEXT).toContain('执业律师');
  });
});