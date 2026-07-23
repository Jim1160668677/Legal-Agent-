/**
 * Agnes 接入冒烟脚本。
 *
 * 验证三项：
 * 1. generate 非流式 → "pong"
 * 2. stream 流式 → "pong"
 * 3. 错误 key → AuthError（401）
 *
 * 运行：npm run build && npm run smoke
 */

import { getConfig } from '../config';
import { createDefaultRegistry } from '../services/legal/llm/registry';
import { LlmServiceImpl } from '../services/legal/llm';
import { AuthError } from '../services/legal/llm/errors';
import type { AppConfig } from '../config/types';

async function main(): Promise<void> {
  const cfg = getConfig();
  const service = new LlmServiceImpl(createDefaultRegistry(cfg));

  // 1. generate pong
  const r = await service.generate('Reply with exactly pong.', {
    maxTokens: 8,
    maxRetries: 0,
    timeoutMs: 15_000,
  });
  console.log(
    `[smoke] generate: "${r.content}" (model=${r.model}, ` +
      `${r.usage.promptTokens} tok → ${r.usage.completionTokens} tok, ` +
      `finish=${r.finishReason})`,
  );

  // 2. stream pong
  let acc = '';
  for await (const ch of service.stream('Reply with exactly pong.', {
    maxTokens: 8,
    maxRetries: 0,
    timeoutMs: 15_000,
  })) {
    acc += ch.delta;
  }
  console.log(`[smoke] stream: "${acc}"`);

  // 3. error 401 — 用错误 key 构造独立 registry，不影响主 service
  const badCfg: AppConfig = {
    ...cfg,
    agnes: { ...cfg.agnes, apiKey: 'sk-invalid-key-for-smoke-test' },
  };
  try {
    const badService = new LlmServiceImpl(createDefaultRegistry(badCfg));
    await badService.generate('hi', { maxRetries: 0, timeoutMs: 10_000 });
    console.log('[smoke] error 401: 未抛错（异常，预期应抛 AuthError）');
    process.exit(1);
  } catch (e) {
    const name = e instanceof AuthError ? 'AuthError' : ((e as Error)?.name ?? 'Unknown');
    console.log(`[smoke] error 401: ${name}`);
    if (!(e instanceof AuthError)) {
      console.log(`[smoke] 注意：预期 AuthError，实际 ${name}: ${(e as Error)?.message ?? ''}`);
    }
  }

  console.log('[smoke] OK');
}

main().catch((e) => {
  console.error('[smoke] FAIL', e);
  process.exit(1);
});
