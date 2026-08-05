/**
 * InMemoryStorageAdapter 单元测试（A3-W3 内存对象存储）。
 *
 * 覆盖：
 *   - upload：返回 fileId=key + size + contentType，buffer 防御性拷贝
 *   - getSignedUrl：命中 → memory:// URL；未命中 → 抛错（与 S3 对齐）
 *   - download：返回 Buffer 副本；未命中抛错
 *   - delete / exists
 *   - __peek / __clear / __size 测试辅助
 *
 * 设计依据：A3 §5.1；D-3 决策。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorageAdapter } from '../../src/infra/storage/in-memory.storage';

describe('InMemoryStorageAdapter', () => {
  let storage: InMemoryStorageAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
  });

  it('upload → 返回 fileId=key, size, contentType', async () => {
    const result = await storage.upload('doc/1.pdf', Buffer.from('abc'), {
      contentType: 'application/pdf',
      filename: '1.pdf',
    });
    expect(result).toEqual({ fileId: 'doc/1.pdf', size: 3, contentType: 'application/pdf' });
    expect(storage.__size).toBe(1);
  });

  it('upload 防御性拷贝：外部 Buffer 后续修改不影响已存内容', async () => {
    const buf = Buffer.from('hello');
    await storage.upload('k', buf);
    buf.write('XXXXX');
    const downloaded = await storage.download('k');
    expect(downloaded.toString()).toBe('hello');
  });

  it('getSignedUrl 命中 → memory://<key>?expires=<ts>', async () => {
    await storage.upload('k', Buffer.from('x'));
    const url = await storage.getSignedUrl('k', 3600);
    expect(url).toMatch(/^memory:\/\/k\?expires=\d+$/);
    const expires = parseInt(url.split('expires=')[1], 10);
    expect(expires).toBeGreaterThan(Date.now());
  });

  it('getSignedUrl 未命中 → 抛错（与 S3 对齐）', async () => {
    await expect(storage.getSignedUrl('missing')).rejects.toThrow('object not found');
  });

  it('download → 返回副本，且未命中抛错', async () => {
    await storage.upload('k', Buffer.from('data'));
    const a = await storage.download('k');
    a.write('mut');
    const b = await storage.download('k');
    expect(b.toString()).toBe('data');
    await expect(storage.download('nope')).rejects.toThrow('object not found');
  });

  it('exists / delete', async () => {
    expect(await storage.exists('k')).toBe(false);
    await storage.upload('k', Buffer.from('x'));
    expect(await storage.exists('k')).toBe(true);
    await storage.delete('k');
    expect(await storage.exists('k')).toBe(false);
  });

  it('__clear → 清空存储', async () => {
    await storage.upload('a', Buffer.from('1'));
    await storage.upload('b', Buffer.from('2'));
    expect(storage.__size).toBe(2);
    storage.__clear();
    expect(storage.__size).toBe(0);
  });

  it('__peek → 读取元数据（含 uploadedAt / filename）', async () => {
    await storage.upload('doc', Buffer.from('x'), { filename: 'a.pdf', contentType: 'text/plain' });
    const meta = storage.__peek('doc');
    expect(meta).toBeDefined();
    expect(meta!.filename).toBe('a.pdf');
    expect(meta!.contentType).toBe('text/plain');
    expect(meta!.uploadedAt).toBeGreaterThan(0);
    // 不加 contentType 时字段为 undefined
    await storage.upload('plain', Buffer.from('y'));
    expect(storage.__peek('plain')!.contentType).toBeUndefined();
  });
});