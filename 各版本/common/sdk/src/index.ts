/**
 * 法律智能体多平台统一SDK
 * 基于后端实际API响应格式
 */

// 核心类型
export * from './types.js';

// 核心客户端
export { LegalAgentClient, ApiError } from './client.js';

// 默认导出
export { default } from './client.js';
