/**
 * AuthModule —— 鉴权模块（A1-W2）。
 *
 * 注册：
 *   - JwtModule（密钥来自 app.jwt.secret）
 *   - JwtStrategy（passport-jwt 策略）
 *   - AuthService / RolesGuard
 *   - AuthController（/v1/auth/login, /v1/auth/refresh）
 *
 * 暴露：AuthService / JwtAuthGuard / RolesGuard / @CurrentUser / @Roles
 *
 * 设计依据：A1 §6.1。
 */
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.decorator';
import { AuthController } from './auth.controller';

/**
 * 把 '7d'/'30d' 解析为秒数（jsonwebtoken expiresIn 接受 number 秒）。
 * 与 auth.service.ts 中同名 helper 同实现，避免跨文件导出循环。
 */
function parseDurationToSeconds(s: string): number {
  const m = /^(\d+)\s*([smhd])$/.exec(s.trim());
  if (!m) return 7 * 86400;
  const n = parseInt(m[1], 10);
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * (mult[m[2]] ?? 86400);
}

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('app.jwt.secret'),
        signOptions: {
          expiresIn: parseDurationToSeconds(config.get<string>('app.jwt.expiresIn') ?? '7d'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, RolesGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
