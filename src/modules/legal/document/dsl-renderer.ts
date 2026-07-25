/**
 * DSL 渲染器 —— 法律文书模板解析与变量填充（A3-W2，A3 §4.2-4.3）。
 *
 * 纯函数模块，无 @Injectable，无 NestJS 依赖，便于单测与 SSR 复用。
 *
 * DSL 语法：
 *   {{var}}             变量替换（支持点路径 {{user.name}}）
 *   {{#each list}}...{{/each}}  循环（对象数组按字段访问；字符串数组用 {{this}}）
 *   {{#if cond}}...{{/if}}      条件块（truthy 渲染；反向用 {{#if not.cond}}）
 *
 * 解析策略：tokenizer → 栈式递归下降解析（最大嵌套深度 5）→ AST 渲染。
 *   - 未闭合块 / 不匹配的闭合标签 → RenderError(unclosed_block | invalid_block)
 *   - 超过最大深度 → RenderError(max_depth)
 *   - 缺失变量：默认渲染为空，可配 opts.missingVar='throw' 抛 RenderError(unknown_var)
 *
 * validateVars：必填/类型/格式/maxLength 校验；list 递归 itemSchema；party_group 递归 fields。
 *
 * 设计依据：A3 §4.2-4.3；A3-W2 实施计划阶段 5。
 */

// ===== 类型定义 =====

export type VarType = 'string' | 'number' | 'boolean' | 'date' | 'list' | 'party_group';

/** 变量 schema（文书模板字段定义） */
export interface VarSchema {
  name: string;
  type: VarType;
  required?: boolean;
  /** 字符串最大长度 */
  maxLength?: number;
  /** 字符串格式校验（正则字面量字符串，如 '^\\d{4}-\\d{2}-\\d{2}$'） */
  format?: string;
  /** 展示名（错误信息用） */
  label?: string;
  /** list 类型：每项的子 schema */
  itemSchema?: VarSchema[];
  /** party_group 类型：子字段 schema */
  fields?: VarSchema[];
}

export type ValidationErrorCode = 'required' | 'type' | 'format' | 'maxLength';

export interface ValidationIssue {
  field: string;
  code: ValidationErrorCode;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export type RenderErrorCode =
  'unclosed_block' | 'invalid_block' | 'max_depth' | 'unknown_var' | 'syntax';

export class RenderError extends Error {
  readonly code: RenderErrorCode;
  constructor(code: RenderErrorCode, message: string) {
    super(message);
    this.name = 'RenderError';
    this.code = code;
  }
}

export interface RenderOptions {
  /** 缺失变量处理：'empty' 渲染为空（默认）| 'throw' 抛 RenderError(unknown_var) */
  missingVar?: 'empty' | 'throw';
}

// ===== AST =====

type AstNode =
  | { kind: 'text'; text: string }
  | { kind: 'var'; path: string }
  | { kind: 'each'; listPath: string; children: AstNode[] }
  | { kind: 'if'; condPath: string; negate: boolean; children: AstNode[] };

/** 最大嵌套深度（A3 §4.2 栈式解析约束） */
const MAX_DEPTH = 5;

// ===== Tokenizer =====

type TokenType = 'text' | 'var' | 'open_each' | 'close_each' | 'open_if' | 'close_if';
interface Token {
  type: TokenType;
  value: string;
  negate?: boolean;
}

/** 匹配 {{ ... }} 标签（标签内不含 } 字符） */
const TAG_RE = /\{\{([^}]*)\}\}/g;

function tokenize(template: string): Token[] {
  const tokens: Token[] = [];
  TAG_RE.lastIndex = 0;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(template)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ type: 'text', value: template.slice(lastIndex, m.index) });
    }
    const inner = m[1].trim();
    if (inner.startsWith('#each')) {
      tokens.push({ type: 'open_each', value: inner.slice(5).trim() });
    } else if (inner === '/each') {
      tokens.push({ type: 'close_each', value: '' });
    } else if (inner.startsWith('#if')) {
      const cond = inner.slice(3).trim();
      let negate = false;
      let path = cond;
      if (cond.startsWith('not.')) {
        negate = true;
        path = cond.slice(4).trim();
      }
      tokens.push({ type: 'open_if', value: path, negate });
    } else if (inner === '/if') {
      tokens.push({ type: 'close_if', value: '' });
    } else if (inner.length > 0) {
      tokens.push({ type: 'var', value: inner });
    } else {
      throw new RenderError('syntax', '空标签 {{}}');
    }
    lastIndex = TAG_RE.lastIndex;
  }
  if (lastIndex < template.length) {
    tokens.push({ type: 'text', value: template.slice(lastIndex) });
  }
  return tokens;
}

// ===== Parser（栈式递归下降） =====

function parse(tokens: Token[]): AstNode[] {
  const root: AstNode[] = [];
  /** 栈帧：当前填充的 children 数组 + 期望的闭合标签 */
  const stack: { children: AstNode[]; close: 'each' | 'if' }[] = [];
  let current: AstNode[] = root;

  for (const tok of tokens) {
    switch (tok.type) {
      case 'text':
        current.push({ kind: 'text', text: tok.value });
        break;
      case 'var':
        current.push({ kind: 'var', path: tok.value });
        break;
      case 'open_each': {
        if (stack.length >= MAX_DEPTH) {
          throw new RenderError('max_depth', `嵌套深度超过最大值 ${MAX_DEPTH}`);
        }
        const node: AstNode = { kind: 'each', listPath: tok.value, children: [] };
        current.push(node);
        stack.push({ children: current, close: 'each' });
        current = node.children;
        break;
      }
      case 'open_if': {
        if (stack.length >= MAX_DEPTH) {
          throw new RenderError('max_depth', `嵌套深度超过最大值 ${MAX_DEPTH}`);
        }
        const node: AstNode = {
          kind: 'if',
          condPath: tok.value,
          negate: tok.negate ?? false,
          children: [],
        };
        current.push(node);
        stack.push({ children: current, close: 'if' });
        current = node.children;
        break;
      }
      case 'close_each': {
        const frame = stack.pop();
        if (!frame || frame.close !== 'each') {
          throw new RenderError('invalid_block', '未匹配的 {{/each}}');
        }
        current = frame.children;
        break;
      }
      case 'close_if': {
        const frame = stack.pop();
        if (!frame || frame.close !== 'if') {
          throw new RenderError('invalid_block', '未匹配的 {{/if}}');
        }
        current = frame.children;
        break;
      }
    }
  }

  if (stack.length > 0) {
    throw new RenderError('unclosed_block', '存在未闭合的块标签');
  }
  return root;
}

// ===== Renderer =====

function resolve(path: string, scopes: unknown[]): unknown {
  // {{this}} → 当前循环项（原始值或对象）
  if (path === 'this') {
    return scopes[scopes.length - 1];
  }
  const parts = path.split('.');
  // {{this.field}} → 当前循环项的字段（原始值时返回 undefined）
  if (parts[0] === 'this') {
    return walkPath(scopes[scopes.length - 1], parts.slice(1));
  }
  // 裸路径：内层对象 scope 优先（#each 对象数组按字段访问），逐层向外
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (scope && typeof scope === 'object' && !Array.isArray(scope) && parts[0] in scope) {
      return walkPath(scope, parts);
    }
  }
  return undefined;
}

function walkPath(obj: unknown, parts: string[]): unknown {
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in cur) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function isTruthy(val: unknown): boolean {
  if (val === undefined || val === null) return false;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') return val.length > 0;
  if (Array.isArray(val)) return val.length > 0;
  return true;
}

function renderAst(nodes: AstNode[], scopes: unknown[], opts: Required<RenderOptions>): string {
  let out = '';
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        out += node.text;
        break;
      case 'var': {
        const val = resolve(node.path, scopes);
        if (val === undefined || val === null) {
          if (opts.missingVar === 'throw') {
            throw new RenderError('unknown_var', `未定义变量: {{${node.path}}}`);
          }
          // 渲染为空
        } else if (typeof val === 'boolean') {
          out += val ? 'true' : 'false';
        } else if (Array.isArray(val)) {
          // 数组裸输出用逗号拼接（一般应通过 #each 处理）
          out += val.join(',');
        } else {
          out += String(val);
        }
        break;
      }
      case 'if': {
        let truthy = isTruthy(resolve(node.condPath, scopes));
        if (node.negate) truthy = !truthy;
        if (truthy) out += renderAst(node.children, scopes, opts);
        break;
      }
      case 'each': {
        const list = resolve(node.listPath, scopes);
        if (Array.isArray(list)) {
          for (const item of list) {
            // 原始项直接作为 scope：对象按字段访问，原始值通过 {{this}} 访问
            out += renderAst(node.children, [...scopes, item], opts);
          }
        }
        // 缺失或非数组 → 跳过（不抛错，由 validateVars 把关必填）
        break;
      }
    }
  }
  return out;
}

// ===== 公开 API =====

/**
 * 渲染 DSL 模板。
 * @param template 模板字符串
 * @param vars 变量字典
 * @param opts 渲染选项（missingVar 默认 'empty'）
 */
export function renderDsl(
  template: string,
  vars: Record<string, unknown>,
  opts: RenderOptions = {},
): string {
  const options: Required<RenderOptions> = { missingVar: opts.missingVar ?? 'empty' };
  const tokens = tokenize(template);
  const ast = parse(tokens);
  return renderAst(ast, [vars], options);
}

/**
 * 校验变量是否符合 schema。
 * 递归处理 list（itemSchema）与 party_group（fields）。
 */
export function validateVars(schema: VarSchema[], vars: Record<string, unknown>): ValidationResult {
  const issues: ValidationIssue[] = [];
  validateSchema(schema, vars ?? {}, '', issues);
  return { valid: issues.length === 0, issues };
}

function validateSchema(
  schema: VarSchema[],
  vars: Record<string, unknown>,
  prefix: string,
  issues: ValidationIssue[],
): void {
  for (const field of schema) {
    const fullName = prefix ? `${prefix}.${field.name}` : field.name;
    const value = vars?.[field.name];

    // 必填检查（undefined / null / 空字符串视为缺失）
    if (value === undefined || value === null || value === '') {
      if (field.required) {
        issues.push({
          field: fullName,
          code: 'required',
          message: `${field.label ?? fullName} 为必填项`,
        });
      }
      continue; // 可选缺失 → 跳过后续检查
    }

    // 类型检查
    if (!checkType(value, field.type)) {
      issues.push({
        field: fullName,
        code: 'type',
        message: `${field.label ?? fullName} 类型应为 ${field.type}，实际为 ${typeof value}`,
      });
      continue; // 类型错则后续约束无意义
    }

    // 字符串约束
    if (field.type === 'string' && typeof value === 'string') {
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        issues.push({
          field: fullName,
          code: 'maxLength',
          message: `${field.label ?? fullName} 超过最大长度 ${field.maxLength}（实际 ${value.length}）`,
        });
      }
      if (field.format) {
        let re: RegExp;
        try {
          re = new RegExp(field.format);
        } catch {
          re = new RegExp('');
        }
        if (!re.test(value)) {
          issues.push({
            field: fullName,
            code: 'format',
            message: `${field.label ?? fullName} 格式不匹配 ${field.format}`,
          });
        }
      }
    }

    // list 递归校验每项
    if (field.type === 'list' && Array.isArray(value) && field.itemSchema) {
      value.forEach((item, i) => {
        const itemPrefix = `${fullName}[${i}]`;
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          // 对象数组：递归子 schema
          validateSchema(field.itemSchema!, item as Record<string, unknown>, itemPrefix, issues);
        } else {
          // 原始值数组（如 string[]）：用 itemSchema[0] 作为项类型描述校验项本身
          const itemField = field.itemSchema![0];
          if (itemField) {
            validateScalar(itemField, item, itemPrefix, issues);
          }
        }
      });
    }

    // party_group 递归校验子字段
    if (
      field.type === 'party_group' &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      field.fields
    ) {
      validateSchema(field.fields, value as Record<string, unknown>, fullName, issues);
    }
  }
}

/**
 * 校验单个标量值（用于原始值数组项）：必填/类型/maxLength/format。
 * 与 validateSchema 中标量字段的校验逻辑一致，抽出以复用。
 */
function validateScalar(
  field: VarSchema,
  value: unknown,
  fullName: string,
  issues: ValidationIssue[],
): void {
  if (value === undefined || value === null || value === '') {
    if (field.required) {
      issues.push({
        field: fullName,
        code: 'required',
        message: `${field.label ?? fullName} 为必填项`,
      });
    }
    return;
  }
  if (!checkType(value, field.type)) {
    issues.push({
      field: fullName,
      code: 'type',
      message: `${field.label ?? fullName} 类型应为 ${field.type}，实际为 ${typeof value}`,
    });
    return;
  }
  if (field.type === 'string' && typeof value === 'string') {
    if (field.maxLength !== undefined && value.length > field.maxLength) {
      issues.push({
        field: fullName,
        code: 'maxLength',
        message: `${field.label ?? fullName} 超过最大长度 ${field.maxLength}（实际 ${value.length}）`,
      });
    }
    if (field.format) {
      let re: RegExp;
      try {
        re = new RegExp(field.format);
      } catch {
        re = new RegExp('');
      }
      if (!re.test(value)) {
        issues.push({
          field: fullName,
          code: 'format',
          message: `${field.label ?? fullName} 格式不匹配 ${field.format}`,
        });
      }
    }
  }
}

function checkType(value: unknown, type: VarType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value);
    case 'list':
      return Array.isArray(value);
    case 'party_group':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}
