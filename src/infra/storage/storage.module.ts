/**
 * StorageModule —— 对象存储模块装配（A3-W3，A3 §5.1）。
 *
 * 通过 OBJECT_STORAGE_TOKEN 提供统一 ObjectStorage 接口，
 * 实际适配器按环境变量切换：
 *   - 开发/测试（默认）：InMemoryStorageAdapter
 *   - 生产：S3StorageAdapter / OSSStorageAdapter（待接入）
 *
 * 切换策略：用 useFactory 根据 ConfigService 选择适配器类。
 * 当前仅注册 InMemory，S3/OSS 适配器在接入 aws-sdk / ali-oss 时扩展。
 *
 * 设计依据：A3 §5.1；D-3 决策。
 */
import { Module } from '@nestjs/common';
import type { ObjectStorage } from './object-storage.interface';
import { OBJECT_STORAGE_TOKEN } from './object-storage.interface';
import { InMemoryStorageAdapter } from './in-memory.storage';

@Module({
  providers: [
    InMemoryStorageAdapter,
    {
      // 当前默认绑定 InMemory；后续接入 S3/OSS 时改为 useFactory 按 env 切换
      provide: OBJECT_STORAGE_TOKEN,
      useExisting: InMemoryStorageAdapter,
    },
  ],
  exports: [OBJECT_STORAGE_TOKEN, InMemoryStorageAdapter],
})
export class StorageModule {}

/** 类型辅助：从 token 取 ObjectStorage 实例 */
export type ObjectStorageInstance = ObjectStorage;
