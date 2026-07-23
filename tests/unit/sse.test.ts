import { describe, it, expect } from 'vitest';
import { parseSse, makeStream } from '../../src/services/legal/llm/sse';

describe('SSE 解析', () => {
  it('正确解析 data: 行', async () => {
    const events: string[] = [];
    for await (const e of parseSse(makeStream(['data: {"a":1}\n\n', 'data: [DONE]\n\n']))) {
      events.push(e.data);
    }
    expect(events).toEqual(['{"a":1}', '[DONE]']);
  });

  it('忽略空行与注释行', async () => {
    const events: string[] = [];
    for await (const e of parseSse(makeStream([': this is a comment\n\ndata: hello\n\n']))) {
      events.push(e.data);
    }
    expect(events).toEqual(['hello']);
  });

  it('data: 后可有 1 个空格', async () => {
    const events: string[] = [];
    for await (const e of parseSse(makeStream(['data:trimmed\n', 'data: with-space\n\n']))) {
      events.push(e.data);
    }
    expect(events).toEqual(['trimmed', 'with-space']);
  });

  it('跨 chunk 边界拼装', async () => {
    // 一行被切到两个 chunk
    const events: string[] = [];
    for await (const e of parseSse(makeStream(['data: {"a":', '1}\n\n']))) {
      events.push(e.data);
    }
    expect(events).toEqual(['{"a":1}']);
  });

  it('忽略 event:/id:/retry: 等其他 SSE 字段', async () => {
    const events: string[] = [];
    const chunks = ['event: message\n', 'id: 42\n', 'retry: 5000\n', 'data: payload\n\n'];
    for await (const e of parseSse(makeStream(chunks))) {
      events.push(e.data);
    }
    expect(events).toEqual(['payload']);
  });

  it('末尾无换行也能解析', async () => {
    const events: string[] = [];
    for await (const e of parseSse(makeStream(['data: end']))) {
      events.push(e.data);
    }
    expect(events).toEqual(['end']);
  });

  it('空流返回空迭代器', async () => {
    const events: string[] = [];
    for await (const e of parseSse(makeStream([]))) {
      events.push(e.data);
    }
    expect(events).toEqual([]);
  });

  it('多行 data 在同一 chunk', async () => {
    const events: string[] = [];
    const chunk = 'data: line1\n\ndata: line2\n\ndata: line3\n\n';
    for await (const e of parseSse(makeStream([chunk]))) {
      events.push(e.data);
    }
    expect(events).toEqual(['line1', 'line2', 'line3']);
  });
});
