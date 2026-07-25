/**
 * AgentRegistry —— Agent 注册与发现（A4-W1，A4 §四）。
 *
 * 职责：
 *   1. register(agent)：注册 Agent（启动时 onModuleInit 调用）
 *   2. lookup(capability)：按 capability 查找主 agent（一个 capability 仅一个主 agent）
 *   3. get(agentId)：按 agentId 查找
 *   4. listCards(filter?)：列出 AgentCard（按 exposure 过滤，供 MCP tools/list 与 /v1/agents）
 *   5. assertExists(agentId/capability)：存在性校验，缺失抛 7006
 *
 * 设计要点：
 *   - 进程级单例：NestJS Provider 默认单例，所有模块共享同一实例
 *   - 一个 capability 仅一个主 agent（避免歧义，A4 §四）
 *   - listCards 按 exposure 过滤：外部 agent 只见 L-Read / L-Write-Limited（L-Internal 不对外）
 *   - 重复注册（同 agentId）抛错，避免启动时静默覆盖
 *
 * 设计依据：A4 §四；11-multi-agent-architecture.md。
 */
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import type { AgentCard, AgentExposure, LegalAgent } from './types';
import { AGENT_ERROR_CODES } from './types';

/** Agent 不存在错误（7006） */
export const AGENT_NOT_FOUND_CODE = AGENT_ERROR_CODES.AGENT_NOT_FOUND;

/** listCards 默认对外暴露的层级（L-Internal 不对外） */
const PUBLIC_EXPOSURE: AgentExposure[] = ['L-Read', 'L-Write-Limited'];

@Injectable()
export class AgentRegistry {
  /** agentId → LegalAgent 映射 */
  private readonly byId = new Map<string, LegalAgent>();
  /** capability → agentId 映射（一个 capability 仅一个主 agent） */
  private readonly capabilityToId = new Map<string, string>();

  /**
   * 注册 Agent。
   * @throws ConflictException agentId 重复 / capability 已被其他 agent 占用
   */
  register(agent: LegalAgent): void {
    const { agentId, capabilities } = agent.card;

    // 1. agentId 唯一性校验
    if (this.byId.has(agentId)) {
      throw new ConflictException({
        code: AGENT_ERROR_CODES.AGENT_NOT_FOUND,
        message: `Agent 已注册，禁止重复注册: ${agentId}`,
      });
    }

    // 2. capability 唯一性校验（一个 capability 仅一个主 agent）
    for (const cap of capabilities) {
      const owner = this.capabilityToId.get(cap);
      if (owner !== undefined) {
        throw new ConflictException({
          code: AGENT_ERROR_CODES.AGENT_NOT_FOUND,
          message: `capability '${cap}' 已被 agent '${owner}' 占用，禁止重复绑定`,
        });
      }
    }

    // 3. 写入索引
    this.byId.set(agentId, agent);
    for (const cap of capabilities) {
      this.capabilityToId.set(cap, agentId);
    }
  }

  /**
   * 按 capability 查找主 agent。
   * @throws NotFoundException capability 未注册（7006）
   */
  lookup(capability: string): LegalAgent {
    const agentId = this.capabilityToId.get(capability);
    if (agentId === undefined) {
      throw new NotFoundException({
        code: AGENT_NOT_FOUND_CODE,
        message: `capability 未注册: ${capability}`,
      });
    }
    const agent = this.byId.get(agentId);
    if (!agent) {
      // 理论不可达（索引一致性保护）
      throw new NotFoundException({
        code: AGENT_NOT_FOUND_CODE,
        message: `capability '${capability}' 索引到不存在的 agent: ${agentId}`,
      });
    }
    return agent;
  }

  /**
   * 按 agentId 查找。
   * @throws NotFoundException agentId 未注册（7006）
   */
  get(agentId: string): LegalAgent {
    const agent = this.byId.get(agentId);
    if (!agent) {
      throw new NotFoundException({
        code: AGENT_NOT_FOUND_CODE,
        message: `Agent 未注册: ${agentId}`,
      });
    }
    return agent;
  }

  /** 是否存在指定 agentId */
  has(agentId: string): boolean {
    return this.byId.has(agentId);
  }

  /** 是否存在指定 capability */
  hasCapability(capability: string): boolean {
    return this.capabilityToId.has(capability);
  }

  /**
   * 列出 AgentCard。
   * @param filter.exposure 暴露层级过滤（默认仅对外暴露 L-Read + L-Write-Limited）
   * @param filter.includeInternal 是否包含 L-Internal（管理后台用，默认 false）
   */
  listCards(filter?: { exposure?: AgentExposure[]; includeInternal?: boolean }): AgentCard[] {
    const includeInternal = filter?.includeInternal ?? false;
    // 默认对外暴露 L-Read + L-Write-Limited；includeInternal=true 追加 L-Internal
    const allowedExposure = filter?.exposure ?? [
      ...PUBLIC_EXPOSURE,
      ...(includeInternal ? ['L-Internal' as AgentExposure] : []),
    ];

    const cards: AgentCard[] = [];
    for (const agent of this.byId.values()) {
      const { exposure } = agent.card;
      if (!allowedExposure.includes(exposure)) continue;
      cards.push(agent.card);
    }
    // 按 agentId 排序，确保输出稳定
    return cards.sort((a, b) => a.agentId.localeCompare(b.agentId));
  }

  /** 已注册 agent 总数 */
  get size(): number {
    return this.byId.size;
  }

  /** 已注册 capability 总数 */
  get capabilityCount(): number {
    return this.capabilityToId.size;
  }

  /**
   * 校验 agent 存在性（不抛异常时返回 agent）。
   * 用于编排器调度前预检。
   */
  assertExists(agentId: string): LegalAgent {
    return this.get(agentId);
  }

  /**
   * 校验 capability 存在性（不抛异常时返回 agent）。
   */
  assertCapability(capability: string): LegalAgent {
    return this.lookup(capability);
  }

  /**
   * 清空注册表（仅用于测试隔离）。
   * 生产环境不应调用。
   */
  clearForTesting(): void {
    this.byId.clear();
    this.capabilityToId.clear();
  }
}
