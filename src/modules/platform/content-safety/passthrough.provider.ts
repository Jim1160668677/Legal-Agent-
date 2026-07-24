/**
 * PassThroughProvider —— A1 默认内容安全适配器（A1-W2）。
 *
 * 不做实际拦截，所有文本判定为 safe。
 * 用途：A1 阶段未接入腾讯云/阿里云（D-5 决策点），保证主链路可联调；
 *       生产环境切换为 TencentCloudProvider。
 *
 * 设计依据：A1 §6.7；A1 §十四 风险（短信网关等内容安全未接入时用占位）。
 */
import { Injectable } from '@nestjs/common';
import type { ContentSafetyProvider, ContentSafetyResult } from './content-safety.types';

@Injectable()
export class PassThroughProvider implements ContentSafetyProvider {
  readonly name = 'passthrough';

  async checkText(text: string): Promise<ContentSafetyResult> {
    // A1 占位：仅做基础长度校验，超长直接拒绝（避免 LLM prompt 注入攻击）
    if (text.length > 10_000) {
      return {
        safe: false,
        reason: '输入超过 10000 字符上限',
        category: 'too_long',
      };
    }
    return { safe: true };
  }
}
