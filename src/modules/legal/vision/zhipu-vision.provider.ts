/**
 * ZhipuVisionProvider — 智谱 GLM-4V 视觉模型 Provider（v2.4）。
 *
 * 智谱 BigModel 多模态 API（OpenAI 兼容）：
 * - Base URL: https://open.bigmodel.cn/api/paas/v4（复用 ZHIPU_BASE_URL）
 * - 端点: POST /chat/completions
 * - 主模型: glm-4v-flash（免费）/ 备: glm-4v-plus（复用同一 ZHIPU_API_KEY）
 * - 请求体: { model, messages:[{role,content:[{type:text},{type:image_url}]}], max_tokens, temperature }
 *
 * 复用 http.ts（超时 + 错误映射）、retry.ts（指数退避）、errors.ts（ParseError）。
 * 不引入 SDK，保持协议透明。
 *
 * 设计依据：.trae/documents/图像识别系统-多模型主备切换.md §1.2
 */
import { httpJson } from '../../../services/legal/llm/http';
import { withRetry } from '../../../services/legal/llm/retry';
import { ParseError } from '../../../services/legal/llm/errors';
import type { VisionInput, VisionOpts, VisionResult, VisionProvider } from './vision.types';

/** 构造参数（由 vision.module.ts 工厂传入） */
export interface ZhipuVisionProviderOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  priority: number;
  timeoutMs: number;
  maxRetries: number;
  baseRetryDelayMs: number;
  maxTokens: number;
  temperature: number;
}

/** 智谱 OpenAI 兼容响应体（与 zhipuProvider.ts 同构） */
interface ZhipuChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { role?: string; content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

const DEFAULT_PROMPT = '请识别图片中的所有文字';

export class ZhipuVisionProvider implements VisionProvider {
  readonly name: string;
  readonly model: string;
  readonly priority: number;

  constructor(private readonly opts: ZhipuVisionProviderOptions) {
    this.model = opts.model;
    this.priority = opts.priority;
    // name 按 model 派生：含 flash → zhipu-flash，否则 zhipu-plus
    this.name = opts.model.includes('flash') ? 'zhipu-flash' : 'zhipu-plus';
  }

  /** 组装 OpenAI 兼容多模态请求体 */
  private buildBody(input: VisionInput): Record<string, unknown> {
    const prompt = input.prompt?.trim() || DEFAULT_PROMPT;
    return {
      model: this.opts.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: input.image } },
          ],
        },
      ],
      max_tokens: this.opts.maxTokens,
      temperature: this.opts.temperature,
    };
  }

  async recognize(input: VisionInput, callOpts?: VisionOpts): Promise<VisionResult> {
    const body = this.buildBody(input);
    const timeoutMs = callOpts?.timeoutMs ?? this.opts.timeoutMs;
    const maxRetries = callOpts?.maxRetries ?? this.opts.maxRetries;

    const res = await withRetry(
      () =>
        httpJson<ZhipuChatResponse>(
          { path: '/chat/completions', method: 'POST', body },
          {
            baseURL: this.opts.baseURL,
            apiKey: this.opts.apiKey,
            timeoutMs,
            signal: callOpts?.signal,
          },
        ),
      {
        maxRetries,
        baseDelayMs: this.opts.baseRetryDelayMs,
        signal: callOpts?.signal,
      },
    );

    const data = res.body;
    const content = data.choices?.[0]?.message?.content;
    if (content === undefined || content === null) {
      throw new ParseError(
        `Zhipu vision response missing choices[0].message.content: ${JSON.stringify(data).slice(0, 200)}`,
      );
    }
    const u = data.usage ?? {};
    return {
      text: content,
      model: data.model ?? this.opts.model,
      usage: {
        promptTokens: u.prompt_tokens ?? 0,
        completionTokens: u.completion_tokens ?? 0,
        totalTokens: u.total_tokens ?? 0,
      },
      raw: data,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      // 最小探针：1x1 透明 PNG，仅验证可达性与鉴权
      await this.recognize(
        {
          image:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
        },
        { maxRetries: 0, timeoutMs: 10_000 },
      );
      return true;
    } catch {
      return false;
    }
  }
}
