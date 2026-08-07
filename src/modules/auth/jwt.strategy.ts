/**
 * JwtStrategy —— passport-jwt 策略（A1-W2）。
 *
 * 从 Authorization: Bearer <token> 头提取 token，调 AuthService.verifyJwt 校验，
 * 返回 JwtPayload 供 @CurrentUser() 装饰器消费。
 *
 * local 模式：跳过 JWT 验证，返回默认用户（local-user）。
 *
 * 设计依据：A1 §6.1 + 03 §六 RBAC。
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { JwtPayload } from './auth.types';

interface JwtStrategyOptions {
  jwtFromRequest: ReturnType<typeof ExtractJwt.fromAuthHeaderAsBearerToken>;
  ignoreExpiration: boolean;
  secretOrKey: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    const isLocal = config.get<string>('app.env') === 'local';

    if (isLocal) {
      // 本地模式：跳过 JWT 验证
      super({
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        ignoreExpiration: true,
        secretOrKey: 'local-dev-secret-change-me',
      } satisfies JwtStrategyOptions);
    } else {
      const secret = config.get<string>('app.jwt.secret');
      if (!secret) {
        throw new Error('app.jwt.secret 配置缺失，无法初始化 JwtStrategy');
      }
      super({
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        ignoreExpiration: false,
        secretOrKey: secret,
      } satisfies JwtStrategyOptions);
    }
  }

  /** passport 校验入口：验证签名/类型，返回 payload 注入 req.user */
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const isLocal = payload.env === 'local';
    if (isLocal) {
      // 本地模式：返回默认用户
      return { sub: 'local-user', role: 'user', type: 'access' };
    }
    if (payload.type !== undefined && payload.type !== 'access') {
      throw new UnauthorizedException({ code: 4011, message: '需 access token' });
    }
    return payload;
  }
}
