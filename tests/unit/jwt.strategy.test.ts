/**
 * JwtStrategy 单元测试（A1-W2 passport-jwt 策略）。
 *
 * 覆盖：
 *   - 缺 app.jwt.secret → 构造抛错
 *   - validate：null user / payload 正常 → 返回 payload
 *   - validate：type 为非 access（refresh 等）→ 4011 Unauthorized
 *
 * 设计依据：A1 §6.1 JWT。
 */
import { describe, it, expect, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from '../../src/modules/auth/jwt.strategy';

function makeConfig(secret?: string) {
  return { get: vi.fn((key: string) => (key === 'app.jwt.secret' ? secret : undefined)) } as never;
}

describe('JwtStrategy', () => {
  it('缺 app.jwt.secret → 构造抛错', () => {
    expect(() => new JwtStrategy(makeConfig(undefined))).toThrow('app.jwt.secret 配置缺失');
  });

  it('validate：type 缺失（纯 access payload）→ 返回 payload', async () => {
    const strat = new JwtStrategy(makeConfig('s'.repeat(32)));
    const payload = { sub: 'u1', username: 'ops-1', role: 'ops' };
    await expect(strat.validate(payload)).resolves.toBe(payload);
  });

  it('validate：type=access → 返回 payload', async () => {
    const strat = new JwtStrategy(makeConfig('s'.repeat(32)));
    const payload = { sub: 'u1', username: 'u', role: 'user', type: 'access' as const };
    await expect(strat.validate(payload)).resolves.toBe(payload);
  });

  it('validate：type=refresh → 抛 4011 Unauthorized', async () => {
    const strat = new JwtStrategy(makeConfig('s'.repeat(32)));
    const payload = { sub: 'u1', username: 'u', role: 'user', type: 'refresh' as const };
    const err: UnauthorizedException = await strat.validate(payload).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err.getResponse() as { code: number }).code).toBe(4011);
  });
});