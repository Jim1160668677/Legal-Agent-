/**
 * @CurrentUser() 装饰器单元测试（A1-W2）。
 *
 * 通过 ROUTE_ARGS_METADATA 提取装饰器工厂并直接调用，覆盖：
 *   - 无 user → undefined
 *   - 无参数 → 整个 payload
 *   - 带 key（sub/role）→ 单字段
 *
 * 设计依据：A1 §三 common/decorators。
 */
import { describe, it, expect } from 'vitest';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser } from '../../src/modules/auth/current-user.decorator';

function getFactory(data?: unknown) {
  class Dummy {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    handler(@CurrentUser(data as never) user: unknown) {}
  }
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, Dummy, 'handler');
  const key = Object.keys(metadata)[0];
  return metadata[key].factory;
}

function makeCtx(user?: unknown) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as never;
}

describe('@CurrentUser()', () => {
  it('req.user 缺失 → undefined', () => {
    const factory = getFactory(undefined);
    expect(factory(undefined, makeCtx(undefined))).toBeUndefined();
  });

  it('无参数 → 返回整个 payload', () => {
    const factory = getFactory(undefined);
    const payload = { sub: 'u1', username: 'ops-1', role: 'ops' };
    expect(factory(undefined, makeCtx(payload))).toEqual(payload);
  });

  it('带 key → 返回单字段', () => {
    const payload = { sub: 'u1', username: 'ops-1', role: 'ops' };
    const subFactory = getFactory('sub');
    const roleFactory = getFactory('role');
    expect(subFactory('sub', makeCtx(payload))).toBe('u1');
    expect(roleFactory('role', makeCtx(payload))).toBe('ops');
  });
});