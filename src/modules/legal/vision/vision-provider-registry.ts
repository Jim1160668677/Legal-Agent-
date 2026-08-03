/**
 * VisionProviderRegistry — Provider 注册表 + 被动式健康状态跟踪（v2.4）。
 *
 * 职责：
 *   - 内存 Map 管理 provider + 健康状态
 *   - sortedByPriority(): 按 priority 升序返回健康 provider
 *   - isHealthy(name): 含冷却期 lazy 恢复（默认 30s）
 *   - recordSuccess/recordFailure: 调用结果驱动健康状态更新（被动式，不消耗 API 额度）
 *
 * 设计依据：.trae/documents/图像识别系统-多模型主备切换.md §1.3 + §健康状态监测
 */
import type { VisionProvider, ProviderHealth, ProviderStatus } from './vision.types';

interface Entry {
  provider: VisionProvider;
  health: ProviderHealth;
}

export class VisionProviderRegistry {
  private readonly map = new Map<string, Entry>();
  private readonly cooldownMs: number;

  constructor(cooldownMs: number) {
    this.cooldownMs = cooldownMs;
  }

  /** 批量注册（vision.module.ts 工厂调用） */
  registerAll(providers: VisionProvider[]): void {
    for (const p of providers) this.register(p);
  }

  /** 单个注册 */
  register(provider: VisionProvider): void {
    this.map.set(provider.name, {
      provider,
      health: { healthy: true, consecutiveFailures: 0 },
    });
  }

  /** 按 priority 升序返回健康 provider（冷却期过自动恢复） */
  sortedByPriority(): VisionProvider[] {
    const list: VisionProvider[] = [];
    for (const [, entry] of this.map) {
      if (this.isHealthy(entry.provider.name)) {
        list.push(entry.provider);
      }
    }
    return list.sort((a, b) => a.priority - b.priority);
  }

  /** 检查指定 provider 是否健康（含冷却期 lazy 恢复逻辑） */
  isHealthy(name: string): boolean {
    const entry = this.map.get(name);
    if (!entry) return false;
    const h = entry.health;
    if (h.healthy) return true;
    // 冷却期恢复：unhealthySince + cooldownMs 过后自动恢复为 healthy
    if (h.unhealthySince !== undefined && Date.now() - h.unhealthySince >= this.cooldownMs) {
      h.healthy = true;
      h.unhealthySince = undefined;
      h.consecutiveFailures = 0;
      return true;
    }
    return false;
  }

  /** 记录成功：重置失败计数，标记健康 */
  recordSuccess(name: string): void {
    const entry = this.map.get(name);
    if (!entry) return;
    entry.health.healthy = true;
    entry.health.consecutiveFailures = 0;
    entry.health.lastSuccessAt = Date.now();
    entry.health.unhealthySince = undefined;
  }

  /** 记录失败：累加失败计数，标记不健康 + 记录起始时间 */
  recordFailure(name: string, _err: unknown): void {
    const entry = this.map.get(name);
    if (!entry) return;
    entry.health.consecutiveFailures += 1;
    entry.health.healthy = false;
    entry.health.unhealthySince = Date.now();
  }

  /** 返回各 provider 健康状态快照（供 GET /v1/vision/health） */
  getStatus(): ProviderStatus[] {
    const out: ProviderStatus[] = [];
    for (const [, entry] of this.map) {
      out.push({
        name: entry.provider.name,
        model: entry.provider.model,
        priority: entry.provider.priority,
        healthy: this.isHealthy(entry.provider.name),
      });
    }
    return out.sort((a, b) => a.priority - b.priority);
  }
}
