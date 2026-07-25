/**
 * JobService —— 异步任务管理（A3-W4，A3 §八）。
 *
 * 职责：
 *   1. create(capability, params, ctx)：创建任务，params L4 加密入库，返回 jobId
 *   2. getStatus(jobId)：查询任务状态 + 解密 params + 结果
 *   3. update(jobId, update)：更新状态/进度/结果
 *   4. runJob(jobId, executor)：执行任务（封装状态机：pending→running→completed/failed）
 *
 * 状态机：
 *   pending → running → completed（success）
 *                     → failed（error）
 *   超时 60s 后强制 failed（A3 §十一风险对策）
 *
 * 雏形模式（A3 §八）：
 *   - 简单轮询：客户端 GET /v1/jobs/{jobId} 查状态
 *   - A4 扩展为完整 JobService + 回调/webhook
 *
 * 安全：
 *   - params L4 加密入库（PiiService.encrypt）
 *   - 查询时解密
 *
 * 错误码（对齐 06-api-spec）：
 *   2003 任务不存在（NotFoundException）
 *
 * 设计依据：A3 §八；A3 §十一风险对策。
 */
import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import {
  AgentJob,
  type AgentJobDocument,
  type JobStatus,
} from '../../../infra/database/schemas/job.schema';
import type { PiiService } from '../../platform/pii/pii.service';
import type { AppLoggerService } from '../../platform/logger/logger.service';
import { requestContext } from '../../../common/context/request-context';

/** 任务不存在错误码（2003） */
export const JOB_NOT_FOUND_CODE = 2003;

/** 任务能力（A3 §八） */
export type { JobCapability } from '../../../infra/database/schemas/job.schema';

/** 任务状态查询结果 */
export interface JobStatusDto {
  jobId: string;
  capability: string;
  status: JobStatus;
  progress: number;
  /** 任务结果（completed 时填充） */
  result?: Record<string, unknown>;
  /** 失败原因（failed 时填充） */
  errorMessage?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  durationMs: number;
}

/** 任务执行器：由调用方提供（如 DocumentGeneratorService.generate） */
export type JobExecutor<T = Record<string, unknown>> = (
  params: T,
) => Promise<Record<string, unknown>>;

/** 任务超时（60s，A3 §十一） */
const JOB_TIMEOUT_MS = 60_000;

@Injectable()
export class JobService {
  constructor(
    @InjectModel(AgentJob.name) private readonly model: Model<AgentJobDocument>,
    @Optional() private readonly pii?: PiiService,
    @Optional() private readonly logger?: AppLoggerService,
  ) {}

  /**
   * 创建任务。
   * @param capability 任务能力（如 'document_generate'）
   * @param params 任务参数（L4 加密入库）
   * @param userId 用户 ID
   */
  async create<T = Record<string, unknown>>(
    capability: string,
    params: T,
    userId: string,
  ): Promise<{ jobId: string; status: 'pending' }> {
    const jobId = randomUUID();
    const now = new Date();
    const expireAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000); // TTL 30 天
    const encryptedParams = this.encryptParams(params, jobId);

    await this.model.create({
      jobId,
      userId,
      capability,
      params: encryptedParams,
      status: 'pending',
      progress: 0,
      result: {},
      createdAt: now,
      expireAt,
    });

    this.logger?.info('JobService: 任务已创建', { jobId, capability, userId });
    return { jobId, status: 'pending' };
  }

  /**
   * 查询任务状态。
   * @param jobId
   * @param includeParams 是否返回解密后的 params（管理后台用）
   */
  async getStatus(
    jobId: string,
    includeParams = false,
  ): Promise<JobStatusDto & { params?: unknown }> {
    const doc = await this.model.findOne({ jobId }).lean<AgentJobDocument>().exec();
    if (!doc) {
      throw new NotFoundException({
        code: JOB_NOT_FOUND_CODE,
        message: `任务不存在: ${jobId}`,
      });
    }
    const dto = this.toDto(doc);
    if (includeParams) {
      return { ...dto, params: this.decryptParams(doc.params, jobId) };
    }
    return dto;
  }

  /**
   * 校验任务所有者。非所有者抛 NotFoundException（避免泄露任务存在性）。
   * @param jobId
   * @param userId 当前用户 ID
   * @param isAdmin 是否管理员（admin 可查任意）
   */
  async assertOwner(jobId: string, userId: string, isAdmin = false): Promise<void> {
    const doc = await this.model.findOne({ jobId }).select({ userId: 1 }).lean().exec();
    if (!doc) {
      throw new NotFoundException({
        code: JOB_NOT_FOUND_CODE,
        message: `任务不存在: ${jobId}`,
      });
    }
    if (!isAdmin && doc.userId !== userId) {
      // 与 NotFoundException 行为一致，避免泄露任务存在性
      throw new NotFoundException({
        code: JOB_NOT_FOUND_CODE,
        message: `任务不存在: ${jobId}`,
      });
    }
  }

  /**
   * 更新任务状态。
   * @param jobId
   * @param update 状态/进度/结果/错误
   */
  async update(
    jobId: string,
    update: {
      status?: JobStatus;
      progress?: number;
      result?: Record<string, unknown>;
      errorMessage?: string;
    },
  ): Promise<void> {
    const $set: Record<string, unknown> = { updatedAt: new Date() };
    if (update.status !== undefined) {
      $set.status = update.status;
      if (update.status === 'running') $set.startedAt = new Date();
      if (update.status === 'completed' || update.status === 'failed') {
        $set.completedAt = new Date();
      }
    }
    if (update.progress !== undefined) $set.progress = update.progress;
    if (update.result !== undefined) $set.result = update.result;
    if (update.errorMessage !== undefined) $set.errorMessage = update.errorMessage;

    await this.model.updateOne({ jobId }, { $set }).exec();
  }

  /**
   * 执行任务（封装状态机 + 超时保护）。
   *
   * @param jobId 任务 ID
   * @param executor 业务执行器（接收解密后的 params，返回结果）
   *
   * 流程：
   *   1. 状态置为 running
   *   2. 解密 params，调用 executor
   *   3. 成功：状态置为 completed，result 填充
   *   4. 失败/超时：状态置为 failed，errorMessage 填充
   *   5. 返回结果（成功）或抛错（失败）
   */
  async runJob<T = Record<string, unknown>>(
    jobId: string,
    executor: JobExecutor<T>,
  ): Promise<Record<string, unknown>> {
    // 1. 加载并校验任务
    const doc = await this.model.findOne({ jobId }).lean<AgentJobDocument>().exec();
    if (!doc) {
      throw new NotFoundException({
        code: JOB_NOT_FOUND_CODE,
        message: `任务不存在: ${jobId}`,
      });
    }
    if (doc.status === 'completed' || doc.status === 'failed') {
      // 幂等：已完成/失败的任务直接返回结果
      this.logger?.warn('JobService: 任务已结束，跳过重复执行', {
        jobId,
        status: doc.status,
      });
      return doc.result;
    }

    // 2. 置为 running
    const startedAt = Date.now();
    await this.update(jobId, { status: 'running', progress: 10 });

    // 3. 执行 + 超时保护
    const ctx = requestContext.get();
    try {
      const params = this.decryptParams(doc.params, jobId) as T;
      const result = await this.withTimeout(executor(params), JOB_TIMEOUT_MS, jobId);

      const durationMs = Date.now() - startedAt;
      await this.model
        .updateOne(
          { jobId },
          {
            $set: {
              status: 'completed',
              progress: 100,
              result,
              completedAt: new Date(),
              updatedAt: new Date(),
              durationMs,
            },
          },
        )
        .exec();

      this.logger?.info('JobService: 任务执行成功', {
        jobId,
        capability: doc.capability,
        durationMs,
        traceId: ctx?.traceId,
      });
      return result;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.model
        .updateOne(
          { jobId },
          {
            $set: {
              status: 'failed',
              errorMessage,
              completedAt: new Date(),
              updatedAt: new Date(),
              durationMs,
            },
          },
        )
        .exec();

      this.logger?.error('JobService: 任务执行失败', {
        jobId,
        capability: doc.capability,
        durationMs,
        error: errorMessage,
        traceId: ctx?.traceId,
      });
      throw err;
    }
  }

  // ===== 内部辅助 =====

  /** 加密 params：JSON.stringify → PiiService.encrypt */
  private encryptParams(params: unknown, jobId: string): string {
    const json = JSON.stringify(params);
    if (!this.pii) {
      this.logger?.warn('JobService: PiiService 未注入，params 明文存储（仅开发环境）', { jobId });
      return json;
    }
    return this.pii.encrypt(json);
  }

  /** 解密 params */
  private decryptParams(encrypted: string, jobId: string): unknown {
    if (!this.pii) {
      try {
        return JSON.parse(encrypted);
      } catch {
        return {};
      }
    }
    try {
      return JSON.parse(this.pii.decrypt(encrypted));
    } catch (err) {
      this.logger?.error('JobService: params 解密失败', {
        jobId,
        error: err instanceof Error ? err.message : String(err),
      });
      return {};
    }
  }

  /** Promise 超时保护 */
  private withTimeout<T>(promise: Promise<T>, ms: number, jobId: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`任务 ${jobId} 超时（${ms}ms）`));
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

  /** 转换 lean 文档为 DTO */
  private toDto(doc: AgentJobDocument): JobStatusDto {
    return {
      jobId: doc.jobId,
      capability: doc.capability,
      // schema 中 status 为 string（避免 union type 推断失败），此处断言为 JobStatus
      status: doc.status as JobStatus,
      progress: doc.progress,
      result: doc.result,
      errorMessage: doc.errorMessage,
      createdAt: doc.createdAt,
      startedAt: doc.startedAt,
      completedAt: doc.completedAt,
      durationMs: doc.durationMs,
    };
  }
}
