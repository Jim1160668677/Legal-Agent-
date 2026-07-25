/**
 * InMemoryStorageAdapter 单元测试（A3-W3）。
 *
 * 覆盖：
 *   - upload：存入 + 返回 fileId/size
 *   - getSignedUrl：返回 memory:// URL（含 expires）
 *   - download：返回 Buffer 副本
 *   - exists：true/false
 *   - delete：删除后 exists=false
 *   - getSignedUrl/download 不存在对象抛错
 *   - 防御性拷贝：外部修改 buffer 不污染存储
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorageAdapter } from '../../src/infra/storage/in-memory.storage';

describe('InMemoryStorageAdapter', () => {
  let storage: InMemoryStorageAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
  });

  describe('upload', () => {
    it('存入并返回 fileId/size/contentType', async () => {
      const buf = Buffer.from('hello world');
      const result = await storage.upload('docs/test.txt', buf, {
        contentType: 'text/plain',
        filename: 'test.txt',
      });
      expect(result.fileId).toBe('docs/test.txt');
      expect(result.size).toBe(11);
      expect(result.contentType).toBe('text/plain');
      expect(storage.__size).toBe(1);
    });

    it('防御性拷贝：外部修改 buffer 不污染存储', async () => {
      const buf = Buffer.from('original');
      await storage.upload('key', buf);
      buf.write('modified!', 0, 'utf8');
      const downloaded = await storage.download('key');
      expect(downloaded.toString('utf8')).toBe('original');
    });
  });

  describe('getSignedUrl', () => {
    it('返回 memory:// URL 含 expires', async () => {
      await storage.upload('key', Buffer.from('data'));
      const url = await storage.getSignedUrl('key', 1800);
      expect(url).toMatch(/^memory:\/\/key\?expires=\d+$/);
      const expires = Number(new URL(url).searchParams.get('expires'));
      expect(expires).toBeGreaterThan(Date.now());
    });

    it('对象不存在时抛错', async () => {
      await expect(storage.getSignedUrl('no-such-key')).rejects.toThrow(/object not found/);
    });
  });

  describe('download', () => {
    it('返回 Buffer 副本', async () => {
      const original = Buffer.from('content');
      await storage.upload('key', original);
      const downloaded = await storage.download('key');
      expect(downloaded.toString('utf8')).toBe('content');
      // 修改下载的 buffer 不污染存储
      downloaded.write('changed', 0, 'utf8');
      const again = await storage.download('key');
      expect(again.toString('utf8')).toBe('content');
    });

    it('对象不存在时抛错', async () => {
      await expect(storage.download('no-such-key')).rejects.toThrow(/object not found/);
    });
  });

  describe('exists', () => {
    it('已上传返回 true', async () => {
      await storage.upload('key', Buffer.from('x'));
      expect(await storage.exists('key')).toBe(true);
    });

    it('未上传返回 false', async () => {
      expect(await storage.exists('no-such-key')).toBe(false);
    });
  });

  describe('delete', () => {
    it('删除后 exists=false', async () => {
      await storage.upload('key', Buffer.from('x'));
      await storage.delete('key');
      expect(await storage.exists('key')).toBe(false);
      expect(storage.__size).toBe(0);
    });

    it('删除不存在的 key 不抛错', async () => {
      await expect(storage.delete('no-such-key')).resolves.toBeUndefined();
    });
  });

  describe('__peek', () => {
    it('返回存储元数据', async () => {
      await storage.upload('key', Buffer.from('data'), { contentType: 'text/plain' });
      const peek = storage.__peek('key');
      expect(peek).toBeDefined();
      expect(peek?.contentType).toBe('text/plain');
      expect(peek?.buffer.length).toBe(4);
    });

    it('未上传返回 undefined', () => {
      expect(storage.__peek('no-such-key')).toBeUndefined();
    });
  });

  describe('__clear', () => {
    it('清空所有对象', async () => {
      await storage.upload('k1', Buffer.from('a'));
      await storage.upload('k2', Buffer.from('b'));
      storage.__clear();
      expect(storage.__size).toBe(0);
    });
  });
});
