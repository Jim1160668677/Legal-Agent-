/**
 * AuthService 类型定义（A1-W2）。
 *
 * JwtPayload：JWT claims 载荷，userId 为内部 UUID；
 * AuthResult：登录成功返回的 token 对；
 * ExternalProvider：外部身份提供方（手机号/微信/邮箱）。
 *
 * 设计依据：A1 §6.1 AuthService。
 */

export type ExternalProvider = 'phone' | 'wechat' | 'email';

/** JWT 内 claims（access 与 refresh 共用，type 字段区分） */
export interface JwtPayload {
  /** 内部 userId（UUID） */
  sub: string;
  /** 调用方角色（user/ops/audit/admin） */
  role?: string;
  /** token 类型：access / refresh */
  type?: 'access' | 'refresh';
  /** 签发时间（秒） */
  iat?: number;
  /** 过期时间（秒） */
  exp?: number;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  userId: string;
  /** 是否首次登录（首次则前端引导完善资料） */
  isNewUser: boolean;
}

export type UserRole = 'user' | 'ops' | 'audit' | 'admin';
