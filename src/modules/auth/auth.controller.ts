/**
 * AuthController —— 登录/刷新端点（A1-W2）。
 *
 * 端点：
 *   POST /v1/auth/login     外部身份（手机号/openid/email）登录，签发 token 对
 *   POST /v1/auth/refresh   refresh token 换新 access
 *
 * 设计依据：A1 §6.1；A1 §十一 微信云开发 → NestJS 迁移（新增登录端点）。
 *
 * 安全注意：A1 阶段密码/验证码占位，生产环境应在调用 service 前校验短信验证码。
 */
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { AuthService } from './auth.service';
import type { ExternalProvider, UserRole } from './auth.types';

class LoginDto {
  provider!: ExternalProvider;
  externalId!: string;
  /** A1 占位字段；生产环境由前置中间件校验短信验证码后剥离 */
  code?: string;
  role?: UserRole;
}

class RefreshDto {
  refreshToken!: string;
}

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
  ): Promise<{ accessToken: string; refreshToken: string; userId: string; isNewUser: boolean }> {
    return this.auth.loginByExternal(dto.provider, dto.externalId, dto.role);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto): Promise<{ accessToken: string; refreshToken: string }> {
    return this.auth.refresh(dto.refreshToken);
  }
}
