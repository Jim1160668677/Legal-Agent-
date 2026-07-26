/**
 * ToolRegistry —— 工具注册与调度（v2.3-W1，14-tool-design.md §2.5）。
 *
 * 职责：
 *   1. register(tool)：注册 LegalTool（启动时 ToolModule.onModuleInit 调用）
 *   2. get(toolId)：按 toolId 查找，不存在抛 LegalToolError(8002)
 *   3. dispatch(toolId, input, ctx)：统一调度入口
 *      - 输入 schema 校验（失败抛 8001）
 *      - 调用 tool.invoke（超时抛 8003）
 *      - 审计 tool_invoke / tool_invoke_failed
 *      - 返回 ToolResult（含 duration / fromCache）
 *   4. list()：列出所有已注册 toolId
 *
 * 设计要点：
 *   - 进程级单例：NestJS Provider 默认单例，ToolAgent 与直连入口共享同一实例
 *   - 重复注册（同 toolId）抛 ConflictException，避免启动时静默覆盖
 *   - schema 校验为内置轻量实现（不依赖 ajv，覆盖 type/required/enum/minimum/maximum/minLength/maxLength）
 *   - 缓存暂未实现（v2.3-W1 阶段聚焦接口与算法，缓存留 v2.4 接入 Redis 时补全）
 *
 * 设计依据：14-tool-design.md §2.5 ToolRegistry；§3.1 输入校验；§3.4 审计与日志。
 */
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import {
  LegalToolError,
  TOOL_ERROR_CODES,
  type LegalTool,
  type JsonSchema,
  type ToolContext,
  type ToolId,
  type ToolResult,
} from './types';

/** 工具调度选项 */
export interface DispatchOptions {
  /** 跳过 schema 校验（内部调用时用，如 ToolAgent 已预校验） */
  skipValidation?: boolean;
}

@Injectable()
export class ToolRegistry {
  /** toolId → LegalTool 映射 */
  private readonly tools = new Map<ToolId, LegalTool>();

  /**
   * 注册工具。
   * @throws ConflictException toolId 重复
   */
  register(tool: LegalTool): void {
    const { toolId } = tool;
    if (this.tools.has(toolId)) {
      throw new ConflictException(`工具已注册，禁止重复注册: ${toolId}`);
    }
    this.tools.set(toolId, tool);
  }

  /**
   * 按 toolId 查找工具。
   * @throws NotFoundException 工具不存在（包装为 8002 语义）
   */
  get(toolId: ToolId): LegalTool {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new NotFoundException(`工具未注册: ${toolId}`);
    }
    return tool;
  }

  /** 是否存在指定工具 */
  has(toolId: ToolId): boolean {
    return this.tools.has(toolId);
  }

  /** 列出所有已注册 toolId（按字母序） */
  list(): ToolId[] {
    return Array.from(this.tools.keys()).sort();
  }

  /** 已注册工具总数 */
  get size(): number {
    return this.tools.size;
  }

  /**
   * 统一调度入口（14 §2.5）。
   *
   * 流程：
   *   1. 工具存在性校验（缺失抛 8002）
   *   2. 输入 schema 校验（失败抛 8001）
   *   3. 调用 tool.invoke（含超时保护，超时抛 8003）
   *   4. 审计 tool_invoke / tool_invoke_failed
   *   5. 填充 duration，返回 ToolResult
   *
   * 错误处理：
   *   - LegalToolError(8001/8004/8005/8006/8007/8009) → 转 ToolResult.success=false + errorCode
   *   - LegalToolError(8003 超时) → 重新抛出（由调用方决定降级路径）
   *   - 其他未知错误 → 审计失败 + 重新抛出
   */
  async dispatch<T = unknown>(
    toolId: ToolId,
    input: unknown,
    ctx: ToolContext,
    opts?: DispatchOptions,
  ): Promise<ToolResult<T>> {
    const startedAt = Date.now();

    // 1. 工具存在性校验
    const tool = this.tools.get(toolId);
    if (!tool) {
      this.auditFail(ctx, toolId, TOOL_ERROR_CODES.TOOL_NOT_FOUND, '工具未注册', 0);
      throw new LegalToolError(TOOL_ERROR_CODES.TOOL_NOT_FOUND, `工具未注册: ${toolId}`, toolId);
    }

    // 2. 输入 schema 校验
    if (!opts?.skipValidation) {
      const validateError = this.validateInput(input, tool.inputSchema, toolId);
      if (validateError) {
        this.auditFail(
          ctx,
          toolId,
          TOOL_ERROR_CODES.INVALID_INPUT,
          validateError.message,
          Date.now() - startedAt,
        );
        throw validateError;
      }
    }

    // 3. 调用 tool.invoke（含超时保护）
    try {
      const result = await this.invokeWithTimeout(tool.invoke(input, ctx), tool.timeout, toolId);
      const duration = Date.now() - startedAt;
      const finalResult = {
        ...result,
        duration,
      } as ToolResult<T>;

      // 4. 审计成功
      this.auditSuccess(ctx, toolId, duration, result.fromCache ?? false, result.degraded ?? false);

      return finalResult;
    } catch (err) {
      const duration = Date.now() - startedAt;

      // LegalToolError(8003) → 重新抛出
      if (err instanceof LegalToolError && err.code === TOOL_ERROR_CODES.TIMEOUT) {
        this.auditFail(ctx, toolId, TOOL_ERROR_CODES.TIMEOUT, err.message, duration);
        throw err;
      }

      // LegalToolError(其他) → 审计后重新抛出（由调用方决定如何包装为 ToolResult）
      if (err instanceof LegalToolError) {
        this.auditFail(ctx, toolId, err.code, err.message, duration);
        throw err;
      }

      // 未知错误 → 审计 + 重新抛出
      const errorMsg = err instanceof Error ? err.message : String(err);
      ctx.logger?.error('Tool invoke 未知错误', { toolId, error: errorMsg, traceId: ctx.traceId });
      this.auditFail(ctx, toolId, TOOL_ERROR_CODES.REVIEW_INTERNAL_ERROR, errorMsg, duration);
      throw err;
    }
  }

  /**
   * 清空注册表（仅用于测试隔离）。
   * 生产环境不应调用。
   */
  clearForTesting(): void {
    this.tools.clear();
  }

  // ===== 内部方法 =====

  /** Promise 超时保护（14 §3.1） */
  private async invokeWithTimeout<T>(promise: Promise<T>, ms: number, toolId: ToolId): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new LegalToolError(
            TOOL_ERROR_CODES.TIMEOUT,
            `工具 ${toolId} 调用超时（${ms}ms）`,
            toolId,
          ),
        );
      }, ms);
      promise
        .then((v) => {
          clearTimeout(timer);
          resolve(v);
        })
        .catch((err: unknown) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * 轻量 JSON Schema 校验（14 §3.1）。
   * 覆盖：type / required / enum / minimum / maximum / minLength / maxLength / oneOf
   * 不依赖 ajv，避免引入额外依赖。
   */
  private validateInput(input: unknown, schema: JsonSchema, toolId: ToolId): LegalToolError | null {
    if (schema.type === 'object') {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return new LegalToolError(TOOL_ERROR_CODES.INVALID_INPUT, '入参应为 object 类型', toolId);
      }
      const obj = input as Record<string, unknown>;
      // required 校验
      if (schema.required) {
        for (const field of schema.required) {
          if (obj[field] === undefined || obj[field] === null) {
            return new LegalToolError(
              TOOL_ERROR_CODES.INVALID_INPUT,
              `缺失必填字段: ${field}`,
              toolId,
              field,
            );
          }
        }
      }
      // 各字段类型与约束校验
      if (schema.properties) {
        for (const [field, sub] of Object.entries(schema.properties)) {
          if (obj[field] === undefined || obj[field] === null) continue;
          const err = this.validateField(obj[field], sub, toolId, field);
          if (err) return err;
        }
      }
    }
    // oneOf 校验（LawValidityQuery 用）
    if (schema.oneOf && schema.oneOf.length > 0) {
      const obj = input as Record<string, unknown>;
      const matched = schema.oneOf.some((sub) => {
        if (sub.required) {
          return sub.required.every((f) => obj[f] !== undefined && obj[f] !== null);
        }
        return true;
      });
      if (!matched) {
        return new LegalToolError(
          TOOL_ERROR_CODES.INVALID_INPUT,
          '入参不满足任一 oneOf 分支',
          toolId,
        );
      }
    }
    return null;
  }

  /** 单字段校验 */
  private validateField(
    value: unknown,
    schema: JsonSchema,
    toolId: ToolId,
    field: string,
  ): LegalToolError | null {
    // type 校验
    if (schema.type) {
      const typeOk = this.checkType(value, schema.type);
      if (!typeOk) {
        return new LegalToolError(
          TOOL_ERROR_CODES.INVALID_INPUT,
          `字段 ${field} 应为 ${schema.type} 类型`,
          toolId,
          field,
        );
      }
    }
    // enum 校验
    if (schema.enum && !schema.enum.includes(value as string | number)) {
      return new LegalToolError(
        TOOL_ERROR_CODES.INVALID_INPUT,
        `字段 ${field} 不在枚举范围内: ${schema.enum.join(', ')}`,
        toolId,
        field,
      );
    }
    // 数值范围
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        return new LegalToolError(
          TOOL_ERROR_CODES.INVALID_INPUT,
          `字段 ${field} 不能小于 ${schema.minimum}`,
          toolId,
          field,
        );
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        return new LegalToolError(
          TOOL_ERROR_CODES.INVALID_INPUT,
          `字段 ${field} 不能大于 ${schema.maximum}`,
          toolId,
          field,
        );
      }
    }
    // 字符串长度
    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        return new LegalToolError(
          TOOL_ERROR_CODES.INVALID_INPUT,
          `字段 ${field} 长度不能小于 ${schema.minLength}`,
          toolId,
          field,
        );
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        return new LegalToolError(
          TOOL_ERROR_CODES.INVALID_INPUT,
          `字段 ${field} 长度不能超过 ${schema.maxLength}`,
          toolId,
          field,
        );
      }
    }
    // 嵌套 object
    if (schema.type === 'object' && schema.properties && typeof value === 'object') {
      return this.validateInput(value, schema, toolId);
    }
    return null;
  }

  /** JSON Schema 类型检查 */
  private checkType(value: unknown, type: string): boolean {
    switch (type) {
      case 'string':
        return typeof value === 'string';
      case 'number':
      case 'integer':
        return typeof value === 'number' && (type !== 'integer' || Number.isInteger(value));
      case 'boolean':
        return typeof value === 'boolean';
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      default:
        return true;
    }
  }

  /** 审计工具调用成功 */
  private auditSuccess(
    ctx: ToolContext,
    toolId: ToolId,
    duration: number,
    fromCache: boolean,
    degraded: boolean,
  ): void {
    ctx.auditLog?.write('tool_invoke', {
      toolId,
      traceId: ctx.traceId,
      userId: ctx.userId,
      success: true,
      duration,
      fromCache,
      degraded,
    });
  }

  /** 审计工具调用失败 */
  private auditFail(
    ctx: ToolContext,
    toolId: ToolId,
    code: number,
    message: string,
    duration: number,
  ): void {
    ctx.auditLog?.write('tool_invoke_failed', {
      toolId,
      traceId: ctx.traceId,
      userId: ctx.userId,
      success: false,
      errorCode: code,
      errorMessage: message,
      duration,
    });
  }
}
