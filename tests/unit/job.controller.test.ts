/**
 * JobController 单元测试（A3-W4）。
 *
 * 覆盖：
 *   - GET /v1/jobs/:jobId：所有者查询 → 返回状态
 *   - 非所有者 → assertOwner 抛 404
 *   - includeParams=true + admin → 返回 params
 *   - includeParams=true + 非 admin → 不返回 params
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobController } from '../../src/modules/legal/job/job.controller';

function makeJobService() {
  return {
    getStatus: vi.fn(),
    assertOwner: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    runJob: vi.fn(),
  };
}

const mockUser = { sub: 'u1', role: 'user' };
const mockAdmin = { sub: 'admin1', role: 'admin' };

describe('JobController', () => {
  let jobService: ReturnType<typeof makeJobService>;
  let controller: JobController;

  beforeEach(() => {
    jobService = makeJobService();
    controller = new JobController(jobService as never);
  });

  describe('GET /:jobId', () => {
    it('所有者查询 → 返回状态', async () => {
      jobService.getStatus.mockResolvedValueOnce({
        jobId: 'j1',
        status: 'completed',
        progress: 100,
        result: { docId: 'd1' },
      });

      const result = await controller.getStatus('j1', mockUser as never);

      expect(jobService.assertOwner).toHaveBeenCalledWith('j1', 'u1', false);
      expect(jobService.getStatus).toHaveBeenCalledWith('j1', false);
      expect(result.status).toBe('completed');
    });

    it('非所有者 → assertOwner 抛错（透传）', async () => {
      jobService.assertOwner.mockRejectedValueOnce(new Error('not owner'));
      await expect(controller.getStatus('j1', mockUser as never)).rejects.toThrow('not owner');
      expect(jobService.getStatus).not.toHaveBeenCalled();
    });

    it('admin + includeParams=true → 返回含 params', async () => {
      jobService.getStatus.mockResolvedValueOnce({
        jobId: 'j1',
        status: 'pending',
        params: { templateCode: 't1' },
      });

      const result = await controller.getStatus('j1', mockAdmin as never, 'true');

      expect(jobService.assertOwner).toHaveBeenCalledWith('j1', 'admin1', true);
      expect(jobService.getStatus).toHaveBeenCalledWith('j1', true);
      expect(result.params).toEqual({ templateCode: 't1' });
    });

    it('非 admin + includeParams=true → 不传 params', async () => {
      jobService.getStatus.mockResolvedValueOnce({
        jobId: 'j1',
        status: 'pending',
      });

      await controller.getStatus('j1', mockUser as never, 'true');

      // 非 admin 即使传 includeParams=true，也传 false
      expect(jobService.getStatus).toHaveBeenCalledWith('j1', false);
    });

    it('未传 includeParams → 默认 false', async () => {
      jobService.getStatus.mockResolvedValueOnce({ jobId: 'j1', status: 'running' });
      await controller.getStatus('j1', mockUser as never);
      expect(jobService.getStatus).toHaveBeenCalledWith('j1', false);
    });
  });
});
