/**
 * ProviderRegistry — 多供应商注册与切换。
 *
 * 进程级注册表，按 name 注册 provider，按 LLM_PROVIDER 环境变量选 active。
 * 支持运行时 setActive 切换，LlmService 始终委托 registry.active。
 *
 * 设计依据：docs/design/04-module-design.md（多厂商切换）。
 */

import type { LlmProvider } from './provider';
import { AgnesProvider } from './agnesProvider';
import { QwenProvider } from './qwenProvider';
import type { AppConfig } from '../../../config/types';

export class ProviderRegistry {
  private readonly providers = new Map<string, LlmProvider>();
  private _activeName: string;

  constructor() {
    this._activeName = '';
  }

  /** 注册 provider（同名覆盖） */
  register(p: LlmProvider): void {
    this.providers.set(p.name, p);
    // 首个注册的 provider 自动设为 active
    if (this._activeName === '') {
      this._activeName = p.name;
    }
  }

  /** 按 name 获取 provider */
  get(name: string): LlmProvider | undefined {
    return this.providers.get(name);
  }

  /** 是否已注册 */
  has(name: string): boolean {
    return this.providers.has(name);
  }

  /** 设置 active provider；未注册时抛错 */
  setActive(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(
        `Cannot set active provider to '${name}': not registered. ` +
          `Registered: ${[...this.providers.keys()].join(', ')}`,
      );
    }
    this._activeName = name;
  }

  /** 当前 active provider */
  get active(): LlmProvider {
    const p = this.providers.get(this._activeName);
    if (!p) {
      throw new Error(
        `No active provider (activeName='${this._activeName}'). ` +
          `Registered: ${[...this.providers.keys()].join(', ')}`,
      );
    }
    return p;
  }

  /** 当前 active name */
  get activeName(): string {
    return this._activeName;
  }

  /** 列出所有已注册 provider */
  list(): LlmProvider[] {
    return [...this.providers.values()];
  }
}

/**
 * 创建默认 registry：注册 agnes + qwen，按 cfg.llm.provider 设 active。
 */
export function createDefaultRegistry(cfg: AppConfig): ProviderRegistry {
  const reg = new ProviderRegistry();
  reg.register(new AgnesProvider(cfg.agnes, cfg.llm));
  reg.register(new QwenProvider(cfg.qwen, cfg.llm));
  reg.setActive(cfg.llm.provider);
  return reg;
}
