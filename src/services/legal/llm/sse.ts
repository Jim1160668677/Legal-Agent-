/**
 * SSE（Server-Sent Events）流解析器。
 *
 * OpenAI 兼容的 /chat/completions stream=true 响应格式：
 *   data: {json}\n\n
 *   data: {json}\n\n
 *   data: [DONE]\n\n
 *
 * 解析为 SseEvent 异步迭代器，供 AgnesProvider.stream 消费。
 */

export interface SseEvent {
  data: string;
}

/**
 * 将 ReadableStream<Uint8Array> 解析为 SseEvent 异步迭代器。
 *
 * 处理规则：
 * - 按 \n 切行，处理跨 chunk 边界的不完整行
 * - 跳过空行（消息分隔符）与 ':' 开头的注释行
 * - 仅提取 `data:` 字段（OpenAI 兼容流不使用 event:/id:/retry:）
 * - data: 后可有 1 个空格（trimStart 处理）
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 按行切分，最后一段可能不完整，保留在 buffer
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        yield* parseLine(line);
      }
    }

    // 处理 buffer 中剩余的最后一行
    if (buffer.length > 0) {
      yield* parseLine(buffer);
    }
  } finally {
    reader.releaseLock();
  }
}

function* parseLine(line: string): Iterable<SseEvent> {
  const trimmed = line.replace(/\r$/, '');
  if (trimmed === '') return; // 空行：消息分隔
  if (trimmed.startsWith(':')) return; // 注释行

  if (trimmed.startsWith('data:')) {
    const data = trimmed.slice(5).trimStart();
    yield { data };
  }
  // 忽略 event:/id:/retry: 等其他 SSE 字段
}

/**
 * 工具：从字符串数组构造 ReadableStream<Uint8Array>，供单测使用。
 */
export function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(c));
      }
      controller.close();
    },
  });
}
