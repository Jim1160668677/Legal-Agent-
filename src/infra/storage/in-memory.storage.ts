/**
 * InMemoryStorageAdapter —— 内存对象存储适配器（A3-W3，A3 §5.1）。
 *
 * 用途：
 *   - 开发环境：无需启动 MinIO 即可走通文书导出全链路
 *   - 单元/集成测试：避免外部依赖，断言上传内容
 *
 * 语义：
 *   - upload：存入 Map<key, Buffer>，返回 fileId=key（与 S3 适配器一致）
 *   - getSignedUrl：返回 `memory://<key>?expires=<ts>` 形式（开发可见，生产适配器返回真实预签名 URL）
 *   - download：返回 Buffer 副本
 *   - exists/delete：操作 Map
 *
 * 线程安全：单进程内 Map 操作原子，多实例部署需替换为真实适配器。
 *
 * 设计依据：A3 §5.1；D-3 决策。
 */
import { Injectable } from '@nestjs/common';
import type { ObjectStorage, UploadOptions, UploadResult } from './object-storage.interface';

interface StoredObject {
  buffer: Buffer;
  contentType?: string;
  filename?: string;
  uploadedAt: number;
}

@Injectable()
export class InMemoryStorageAdapter implements ObjectStorage {
  private readonly store = new Map<string, StoredObject>();

  async upload(key: string, buffer: Buffer, opts?: UploadOptions): Promise<UploadResult> {
    const stored: StoredObject = {
      buffer: Buffer.from(buffer), // 防御性拷贝，避免外部修改
      contentType: opts?.contentType,
      filename: opts?.filename,
      uploadedAt: Date.now(),
    };
    this.store.set(key, stored);
    return {
      fileId: key,
      size: stored.buffer.length,
      contentType: stored.contentType,
    };
  }

  async getSignedUrl(key: string, expiresInSec = 3600): Promise<string> {
    if (!this.store.has(key)) {
      // 与 S3 行为对齐：不存在时抛错（避免返回过期 URL 误导前端）
      throw new Error(`ObjectStorage: object not found: ${key}`);
    }
    const expires = Date.now() + expiresInSec * 1000;
    return `memory://${key}?expires=${expires}`;
  }

  async download(key: string): Promise<Buffer> {
    const obj = this.store.get(key);
    if (!obj) {
      throw new Error(`ObjectStorage: object not found: ${key}`);
    }
    return Buffer.from(obj.buffer); // 返回副本，避免外部修改污染存储
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  // ===== 测试辅助方法（仅开发/测试用，生产适配器不暴露） =====

  /** 测试用：读取元数据（不拷贝 buffer） */
  __peek(key: string): StoredObject | undefined {
    return this.store.get(key);
  }

  /** 测试用：清空存储 */
  __clear(): void {
    this.store.clear();
  }

  /** 测试用：当前存储对象数量 */
  get __size(): number {
    return this.store.size;
  }
}
