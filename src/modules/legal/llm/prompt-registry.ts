/**
 * PromptRegistry —— Prompt 模板版本管理与渲染（A3-W1，A3 §3.1）。
 *
 * 职责：
 *   1. 从 PROMPT_TEMPLATES（src/data/promptTemplates.ts）加载模板，按 templateId 索引
 *   2. get(templateId, version?)：默认返回最新 active 版本；指定 version 时返回该版本（含 deprecated）
 *   3. render(templateId, vars)：{{variable}} 占位符替换 + 缺失变量校验
 *   4. listVersions(templateId)：列出版本（按 version 降序）
 *
 * 渲染规则：
 *   - {{variable}} 替换为 vars[variable] 的字符串值
 *   - {{#if variable}}...{{/if}}：variable 为 truthy 时渲染块内容，falsy 时跳过
 *   - 缺失变量（vars 中不存在）抛 BadRequestException(code:1001)
 *   - 多余变量（vars 中有但模板未声明）静默忽略
 *
 * 设计依据：A3 §3.1；07 §五 Prompt 工程规范。
 */
import { Injectable, BadRequestException } from '@nestjs/common';
import { PROMPT_TEMPLATES, type PromptTemplate } from '../../../data/promptTemplates';

/** 渲染结果 */
export interface RenderedPrompt {
  system: string;
  user: string;
}

/** {{#if var}}...{{/if}} 条件块正则 */
const IF_BLOCK_PATTERN = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
/** {{variable}} 变量占位符正则 */
const VAR_PATTERN = /\{\{(\w+)\}\}/g;

@Injectable()
export class PromptRegistry {
  /** templateId → 按版本降序的模板列表 */
  private readonly templates = new Map<string, PromptTemplate[]>();

  constructor() {
    for (const t of PROMPT_TEMPLATES) {
      const list = this.templates.get(t.templateId) ?? [];
      list.push(t);
      this.templates.set(t.templateId, list);
    }
    // 每个列表按 version 降序
    for (const list of this.templates.values()) {
      list.sort((a, b) => b.version - a.version);
    }
  }

  /**
   * 获取模板。
   * @param templateId 模板 ID
   * @param version 指定版本（含 deprecated）；不传返回最新 active 版本
   * @returns 模板；未找到返回 undefined
   */
  get(templateId: string, version?: number): PromptTemplate | undefined {
    const list = this.templates.get(templateId);
    if (!list || list.length === 0) return undefined;

    if (version !== undefined) {
      return list.find((t) => t.version === version);
    }
    // 默认返回最新 active 版本
    return list.find((t) => t.status === 'active') ?? list[0];
  }

  /**
   * 渲染模板：替换变量 + 处理条件块。
   * @param templateId 模板 ID
   * @param vars 变量值映射
   * @returns { system, user } 渲染后的系统/用户提示
   * @throws BadRequestException 模板不存在或变量缺失
   */
  render(templateId: string, vars: Record<string, unknown>): RenderedPrompt {
    const tmpl = this.get(templateId);
    if (!tmpl) {
      throw new BadRequestException({
        code: 1001,
        message: `Prompt template not found: ${templateId}`,
      });
    }

    // 校验缺失变量（仅校验模板声明的变量，不校验条件块内的局部变量）
    const missing = tmpl.variables.filter((v) => !(v in vars));
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 1001,
        message: `Missing prompt variables: ${missing.join(', ')}`,
        missing,
      });
    }

    return {
      system: this.renderString(tmpl.systemPrompt, vars),
      user: this.renderString(tmpl.userPromptTemplate, vars),
    };
  }

  /**
   * 列出模板的所有版本（按 version 降序）。
   * @param templateId 模板 ID
   * @returns 版本列表；模板不存在返回空数组
   */
  listVersions(templateId: string): PromptTemplate[] {
    return this.templates.get(templateId) ?? [];
  }

  // ===== 内部方法 =====

  /** 渲染单个字符串：先处理条件块，再替换变量 */
  private renderString(template: string, vars: Record<string, unknown>): string {
    // 1. 处理 {{#if var}}...{{/if}} 条件块
    const afterIf = template.replace(
      IF_BLOCK_PATTERN,
      (_match, varName: string, content: string) => {
        const val = vars[varName];
        // truthy 渲染块内容（递归处理嵌套变量），falsy 跳过
        return val ? this.replaceVars(content, vars) : '';
      },
    );

    // 2. 替换剩余 {{variable}}
    return this.replaceVars(afterIf, vars);
  }

  /** 替换 {{variable}} 占位符；未在 vars 中存在的变量保留原样（条件块已处理） */
  private replaceVars(input: string, vars: Record<string, unknown>): string {
    return input.replace(VAR_PATTERN, (match, varName: string) => {
      if (varName in vars) {
        const val = vars[varName];
        // undefined/null 视为空串；其余转为字符串
        return val === undefined || val === null ? '' : String(val);
      }
      // 未在 vars 中的变量保留原样（如条件块内引用的变量可能已在外层声明）
      return match;
    });
  }
}
