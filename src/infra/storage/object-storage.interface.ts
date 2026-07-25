/**
 * ObjectStorage —— 对象存储抽象接口（A3-W3，A3 §5.1）。
 *
 * 替代微信云存储 cloud:// 协议，统一对接 S3 / 阿里云 OSS / MinIO。
 * 文书文件私有读，通过预签名 URL 限时访问（默认 1 小时）。
 *
 * 设计依据：A3 §5.1；D-3 决策（MinIO 开发 + OSS 生产）。
 *
 * 实现策略：
 *   - InMemoryStorageAdapter：开发/测试用，无外部依赖
 *   - S3StorageAdapter / OSSStorageAdapter / MinIOStorageAdapter：生产适配器
 *     （A3 阶段保留桩，接入 aws-sdk / ali-oss 时再实现）
 */
export interface UploadOptions {
  /** MIME 类型，如 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' */
  contentType?: string;
  /** 文件名（用于 Content-Disposition） */
  filename?: string;
  /** 是否私有读（默认 true，仅预签名 URL 可访问） */
  private?: boolean;
}

export interface UploadResult {
  /** 对象存储 key（替代微信 cloud:// fileId） */
  fileId: string;
  /** 对象大小（字节） */
  size: number;
  /** 内容类型 */
  contentType?: string;
}

export interface ObjectStorage {
  /**
   * 上传文件。
   * @param key 对象 key（如 `documents/{docId}/{filename}.docx`）
   * @param buffer 文件二进制
   * @param opts 上传选项
   */
  upload(key: string, buffer: Buffer, opts?: UploadOptions): Promise<UploadResult>;

  /**
   * 获取预签名下载 URL。
   * @param key 对象 key
   * @param expiresInSec 过期秒数（默认 3600 = 1 小时）
   */
  getSignedUrl(key: string, expiresInSec?: number): Promise<string>;

  /**
   * 下载文件二进制（管理后台/服务端内部使用，不走预签名）。
   * @param key 对象 key
   */
  download(key: string): Promise<Buffer>;

  /**
   * 删除对象。
   * @param key 对象 key
   */
  delete(key: string): Promise<void>;

  /**
   * 检查对象是否存在。
   * @param key 对象 key
   */
  exists(key: string): Promise<boolean>;
}

/** Storage 注入 token（NestJS DI 用） */
export const OBJECT_STORAGE_TOKEN = Symbol('OBJECT_STORAGE');
