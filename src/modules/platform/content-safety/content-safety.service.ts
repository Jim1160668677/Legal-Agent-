/**
 * ContentSafetyService —— 内容安全门面（A1-W2）。
 *
 * 职责：
 *   - 注入 ContentSafetyProvider（默认 PassThroughProvider，生产可换腾讯云）
 *   - checkInput/checkOutput：分别校验输入与输出，命中违规抛 6002
 *   - 命中违规写审计（compliance_blocked / agent_pii_violation）
 *
 * 设计依据：A1 §6.7；03 §4.4 违规审计；06 错误码 6002。
 */
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ContentSafetyProvider } from './content-safety.types';
import type { ContentSafetyResult } from './content-safety.types';
import { AuditLogService } from '../audit/audit-log.service';

export const CONTENT_SAFETY_PROVIDER = Symbol('CONTENT_SAFETY_PROVIDER');

@Injectable()
export class ContentSafetyService {
  constructor(
    @Inject(CONTENT_SAFETY_PROVIDER) private readonly provider: ContentSafetyProvider,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * 输入校验（chat/document_generate 入口）。
   * 命中违规抛 6002，并写审计 compliance_blocked。
   */
  async checkInput(text: string): Promise<void> {
    const result = await this.provider.checkText(text);
    if (!result.safe) {
      this.audit.write('compliance_blocked', {
        stage: 'input',
        provider: this.provider.name,
        category: result.category,
        reason: result.reason,
        matchedFragment: result.matchedFragment?.slice(0, 50),
      });
      throw new BadRequestException({
        code: 6002,
        message: `内容安全拦截：${result.reason ?? '输入命中违规'}`,
      });
    }
  }

  /**
   * 输出校验（LLM 响应出口、Agent 响应出口）。
   * 命中违规抛 6002（业务侧应降级为人工引导），并写审计。
   */
  async checkOutput(text: string): Promise<ContentSafetyResult> {
    const result = await this.provider.checkText(text);
    if (!result.safe) {
      this.audit.write('compliance_blocked', {
        stage: 'output',
        provider: this.provider.name,
        category: result.category,
        reason: result.reason,
        matchedFragment: result.matchedFragment?.slice(0, 50),
      });
    }
    return result;
  }
}
