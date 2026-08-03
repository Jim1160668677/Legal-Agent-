/**
 * AuthService —— JWT 鉴权 + 外部身份映射（A1-W2）。
 *
 * 职责：
 *   1. loginByExternal：外部身份（手机号/微信/邮箱）→ 内部 userId，签发 access+refresh
 *      A1 阶段密码登录占位（短信网关 D-6 后续接），mapExternalIdentity 保留微信映射
 *   2. verifyJwt：校验 token 签名/过期/类型
 *   3. refresh：refresh token 换新 access
 *   4. checkOwner：防 4031 横向越权
 *   5. requireRole：防 4032 角色越权
 *
 * 设计依据：A1 §6.1；03 §六 RBAC；06 错误码 4011/4031/4032。
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomUUID } from 'node:crypto';
import type { ExternalProvider, JwtPayload, UserRole } from './auth.types';
import { UserProfile, type UserProfileDocument } from '../../infra/database/schemas/user.schema';
import { AuditLogService } from '../platform/audit/audit-log.service';

/**
 * 把 '7d'/'30d'/'12h' 等时间字符串解析为秒数。
 * jsonwebtoken 的 expiresIn 接受 number（秒）；用本地解析避免 @nestjs/jwt v11
 * 对 ms StringValue branded type 的严格约束。
 */
function parseDurationToSeconds(s: string): number {
  const m = /^(\d+)\s*([smhd])$/.exec(s.trim());
  if (!m) return 7 * 86400;
  const n = parseInt(m[1], 10);
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * (mult[m[2]] ?? 86400);
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectModel(UserProfile.name) private readonly userModel: Model<UserProfileDocument>,
    @Optional() private readonly audit?: AuditLogService,
  ) {}

  // ===== 登录 =====

  /**
   * A1 占位登录：外部身份（手机号/openid/email）直接换 token。
   *
   * 生产环境应在调用本方法前：
   *   - phone：校验短信验证码（D-6 接入后）
   *   - wechat：校验 wx.cloud 上下文 openid
   *   - email：校验邮箱魔法链接
   *
   * @param provider 外部身份提供方
   * @param externalId 手机号 / openid / email
   * @param role 内部角色（默认 user）
   */
  async loginByExternal(
    provider: ExternalProvider,
    externalId: string,
    role: UserRole = 'user',
  ): Promise<{ accessToken: string; refreshToken: string; userId: string; isNewUser: boolean }> {
    if (!externalId || externalId.trim() === '') {
      throw new BadRequestException({ code: 1001, message: 'externalId 不能为空' });
    }
    const existingUserId = await this.mapExternalIdentity(provider, externalId);
    const isNewUser = existingUserId === '';
    const userId = isNewUser ? await this.createExternalUser(provider, externalId) : existingUserId;

    const tokens = await this.issueTokens(userId, role);

    // 登录审计（user_login 事件）
    this.audit?.write(
      'user_login',
      { provider, isNewUser, role },
      { userId, result: 'success', func: 'login' },
    );

    return { ...tokens, isNewUser };
  }

  /**
   * 刷新 access token。
   * @throws 4011 refresh token 无效/过期/类型不匹配
   */
  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException({ code: 4011, message: 'refresh token 无效或已过期' });
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException({ code: 4011, message: 'token 类型不匹配' });
    }
    const role = (payload.role ?? 'user') as UserRole;
    const tokens = await this.issueTokens(payload.sub, role);
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  }

  // ===== JWT 校验 =====

  /**
   * 校验 access token，返回 payload。
   * @throws 4011 token 无效/过期/类型不匹配
   */
  verifyJwt(token: string, expectedType: 'access' | 'refresh' = 'access'): JwtPayload {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException({ code: 4011, message: 'token 无效或已过期' });
    }
    if (expectedType !== undefined && payload.type !== expectedType) {
      throw new UnauthorizedException({ code: 4011, message: 'token 类型不匹配' });
    }
    return payload;
  }

  // ===== 越权防护 =====

  /**
   * 横向越权防护：调用方 caller 是否拥有 resourceOwnerId 的资源。
   * @throws 4031 越权
   */
  async checkOwner(resourceOwnerId: string, callerId: string): Promise<void> {
    if (resourceOwnerId !== callerId) {
      throw new ForbiddenException({ code: 4031, message: '越权访问他人资源' });
    }
  }

  /**
   * 角色越权防护：调用方角色是否满足最低要求。
   * @throws 4032 无操作权限
   */
  async requireRole(caller: JwtPayload, required: UserRole): Promise<void> {
    const callerRole = (caller.role ?? 'user') as UserRole;
    const rank: Record<UserRole, number> = { user: 0, ops: 1, audit: 1, admin: 2 };
    if (rank[callerRole] < rank[required]) {
      throw new ForbiddenException({ code: 4032, message: '无操作权限' });
    }
  }

  // ===== 外部身份映射 =====

  /**
   * 外部身份 → 内部 userId。
   * 命中返回 userId；未命中返回空字符串（由 loginByExternal 决定是否创建）。
   *
   * 设计要点（A1 §6.1）：保留微信 openid→userId 映射，为小程序端共存预留。
   */
  async mapExternalIdentity(provider: ExternalProvider, externalId: string): Promise<string> {
    // phone 用 phoneHash 索引查；wechat/email 用 externalIdentities 子文档查
    if (provider === 'phone') {
      const phoneHash = this.hashPhone(externalId);
      const doc = await this.userModel.findOne({ phoneHash }).select({ userId: 1 }).lean().exec();
      return doc?.userId ?? '';
    }
    const doc = await this.userModel
      .findOne({ externalIdentities: { $elemMatch: { provider, externalId } } })
      .select({ userId: 1 })
      .lean()
      .exec();
    return doc?.userId ?? '';
  }

  // ===== 私有辅助 =====

  /** 签发 access + refresh token 对 */
  private async issueTokens(
    userId: string,
    role: UserRole,
  ): Promise<{ accessToken: string; refreshToken: string; userId: string; isNewUser: false }> {
    // parseDurationToSeconds 把 '7d'/'30d' 转秒数，避免 @nestjs/jwt v11 StringValue 约束
    const accessExpiresIn = parseDurationToSeconds(
      this.config.get<string>('app.jwt.expiresIn') ?? '7d',
    );
    const refreshExpiresIn = parseDurationToSeconds(
      this.config.get<string>('app.jwt.refreshExpiresIn') ?? '30d',
    );

    const accessPayload: JwtPayload = { sub: userId, role, type: 'access' };
    const refreshPayload: JwtPayload = { sub: userId, role, type: 'refresh' };

    const accessToken = await this.jwt.signAsync(accessPayload, { expiresIn: accessExpiresIn });
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      expiresIn: refreshExpiresIn,
    });

    // 登录后更新 lastActiveAt（非阻塞）
    void this.userModel
      .updateOne({ userId }, { $set: { lastActiveAt: new Date() } })
      .exec()
      .catch(() => {
        /* 更新活跃时间失败不阻塞登录 */
      });

    return { accessToken, refreshToken, userId, isNewUser: false };
  }

  /** 创建外部身份用户（首次登录） */
  private async createExternalUser(
    provider: ExternalProvider,
    externalId: string,
  ): Promise<string> {
    const userId = randomUUID();
    const doc: Partial<UserProfile> = {
      userId,
      externalIdentities: [{ provider, externalId }],
      legalPreferences: {},
    };
    if (provider === 'phone') {
      doc.phoneHash = this.hashPhone(externalId);
    }
    await this.userModel.create(doc);
    return userId;
  }

  /** 手机号哈希（SHA-256 + 固定 salt；salt 生产环境应走环境变量） */
  private hashPhone(phone: string): string {
    const salt = this.config.get<string>('app.jwt.secret') ?? 'legal-agent-salt';
    return createHash('sha256').update(`${salt}:${phone}`).digest('hex');
  }
}
