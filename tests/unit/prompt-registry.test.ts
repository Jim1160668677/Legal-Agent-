/**
 * PromptRegistry 单元测试（A3-W1）。
 *
 * 覆盖：
 *   - get：默认最新 active / 指定 version / 未找到
 *   - render：变量替换 / 条件块 / 缺失变量校验 / 多余变量忽略
 *   - listVersions：降序返回
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PromptRegistry } from '../../src/modules/legal/llm/prompt-registry';

describe('PromptRegistry', () => {
  let registry: PromptRegistry;

  beforeEach(() => {
    registry = new PromptRegistry();
  });

  describe('get', () => {
    it('默认返回最新 active 版本', () => {
      const t = registry.get('legal_qa_v1');
      expect(t).toBeDefined();
      expect(t?.version).toBe(1);
      expect(t?.status).toBe('active');
    });

    it('指定 version 返回该版本', () => {
      const t = registry.get('legal_qa_v1', 1);
      expect(t).toBeDefined();
      expect(t?.version).toBe(1);
    });

    it('未找到模板返回 undefined', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('未找到版本返回 undefined', () => {
      expect(registry.get('legal_qa_v1', 999)).toBeUndefined();
    });
  });

  describe('render', () => {
    it('替换所有 {{variable}} 占位符', () => {
      const result = registry.render('legal_qa_v1', {
        user_question: '诉讼时效几年？',
        retrieved_context: '民法典第188条',
        user_preferences: '简洁回答',
      });
      expect(result.system).toContain('法律智能助手');
      expect(result.user).toContain('诉讼时效几年？');
      expect(result.user).toContain('民法典第188条');
      expect(result.user).toContain('用户偏好：简洁回答');
    });

    it('缺失变量抛 BadRequestException(1001)', () => {
      expect(() => registry.render('legal_qa_v1', { user_question: '问题' })).toThrow(
        BadRequestException,
      );
      try {
        registry.render('legal_qa_v1', { user_question: '问题' });
      } catch (e) {
        const err = e as BadRequestException;
        const resp = err.getResponse() as { code: number; missing: string[] };
        expect(resp.code).toBe(1001);
        expect(resp.missing).toContain('retrieved_context');
        expect(resp.missing).toContain('user_preferences');
      }
    });

    it('多余变量被静默忽略', () => {
      const result = registry.render('legal_qa_v1', {
        user_question: '问题',
        retrieved_context: '上下文',
        user_preferences: '偏好',
        extra_var: '多余',
      });
      expect(result.user).not.toContain('extra_var');
    });

    it('模板不存在抛 BadRequestException(1001)', () => {
      expect(() => registry.render('nonexistent', {})).toThrow(BadRequestException);
    });

    it('{{#if}} truthy 渲染块内容', () => {
      const result = registry.render('legal_qa_v1', {
        user_question: '问题',
        retrieved_context: '法条上下文',
        user_preferences: '偏好',
      });
      expect(result.user).toContain('相关法条/案例参考');
      expect(result.user).toContain('法条上下文');
    });

    it('{{#if}} falsy 跳过块内容', () => {
      const result = registry.render('legal_qa_v1', {
        user_question: '问题',
        retrieved_context: '', // falsy
        user_preferences: '偏好',
      });
      expect(result.user).not.toContain('相关法条/案例参考');
    });

    it('undefined/null 变量值转为空串', () => {
      const result = registry.render('legal_qa_v1', {
        user_question: '问题',
        retrieved_context: undefined,
        user_preferences: null,
      });
      expect(result.user).not.toContain('undefined');
      expect(result.user).not.toContain('null');
    });

    it('document_generate_v1 模板可正常渲染', () => {
      const result = registry.render('document_generate_v1', {
        doc_type: '民事起诉状',
        vars_json: '{"plaintiff":"张三"}',
        facts: '被告欠款不还',
        retrieved_law_refs: '民法典第188条',
      });
      expect(result.system).toContain('法律文书起草助手');
      expect(result.user).toContain('民事起诉状');
      expect(result.user).toContain('被告欠款不还');
    });
  });

  describe('listVersions', () => {
    it('按 version 降序返回', () => {
      const versions = registry.listVersions('legal_qa_v1');
      expect(versions.length).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < versions.length; i++) {
        expect(versions[i - 1].version).toBeGreaterThanOrEqual(versions[i].version);
      }
    });

    it('模板不存在返回空数组', () => {
      expect(registry.listVersions('nonexistent')).toEqual([]);
    });
  });
});
