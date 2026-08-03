/**
 * 常量定义
 */
export const API_BASE_URL: string = 'https://api.legalagent.com';
export const APP_NAME: string = '法律智能体';
export const APP_VERSION: string = '1.0.0';
export const TOKEN_STORAGE_KEY: string = 'auth_token';
export const REFRESH_TOKEN_STORAGE_KEY: string = 'refresh_token';
export const USER_INFO_STORAGE_KEY: string = 'user_info';
export const LAST_LOGIN_AT_KEY: string = 'last_login_at';

/** 消息类型 */
export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  MIXED = 'mixed'
}

/** 知识分类 */
export enum KnowledgeCategory {
  LAW = 'law',
  REGULATION = 'regulation',
  CASE = 'case',
  INTERPRETATION = 'interpretation',
  POLICY = 'policy'
}

/** 风险等级 */
export enum RiskLevel {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low'
}

/** 消息角色 */
export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant'
}

/** 会话列表页码大小 */
export const SESSION_PAGE_SIZE: number = 20;
/** 消息列表页码大小 */
export const MESSAGE_PAGE_SIZE: number = 20;
/** 知识检索默认返回数量 */
export const KNOWLEDGE_DEFAULT_TOP_K: number = 10;

/** 主色调 */
export const PRIMARY_COLOR: string = '#1890ff';
export const PRIMARY_COLOR_LIGHT: string = '#e6f7ff';
export const TEXT_PRIMARY: string = '#333333';
export const TEXT_SECONDARY: string = '#666666';
export const TEXT_HINT: string = '#999999';
export const BG_COLOR: string = '#f5f5f5';
export const BG_WHITE: string = '#ffffff';
export const BORDER_COLOR: string = '#e8e8e8';
export const ERROR_COLOR: string = '#ff4d4f';
export const SUCCESS_COLOR: string = '#52c41a';
export const WARNING_COLOR: string = '#faad14';

/** 登录超时时间(ms) */
export const LOGIN_TIMEOUT: number = 30000;
/** 消息发送超时时间(ms) */
export const MESSAGE_TIMEOUT: number = 60000;
/** Token刷新偏移时间(ms) - 提前5分钟刷新 */
export const TOKEN_REFRESH_OFFSET: number = 5 * 60 * 1000;
