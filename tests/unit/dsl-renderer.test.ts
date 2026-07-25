/**
 * DSL 渲染器单元测试（A3-W2）。
 *
 * 覆盖（A3 §4.2-4.3 + §十 验收）：
 *   - 变量替换：单变量、对象路径、空白容错、布尔/数值字符串化
 *   - 缺失变量：默认 empty / throw 两种模式
 *   - #if：truthy 渲染、falsy 跳过、not. 反向、空串/数组 falsy
 *   - #each：字符串数组 {{this}}、对象数组 {{this.f}} 与裸字段、空数组、缺失跳过
 *   - 嵌套：#if 内嵌 #each、多层 #each、深度上限 5
 *   - 错误：未闭合块、不匹配闭合、超深度、空标签
 *   - validateVars：必填/类型/格式/maxLength、list 递归、party_group 递归、date
 */
import { describe, it, expect } from 'vitest';
import {
  renderDsl,
  validateVars,
  RenderError,
  type VarSchema,
} from '../../src/modules/legal/document/dsl-renderer';

describe('DSL renderDsl - 变量替换', () => {
  it('纯文本原样返回', () => {
    expect(renderDsl('你好世界', {})).toBe('你好世界');
  });

  it('单变量替换', () => {
    expect(renderDsl('你好，{{name}}！', { name: '张三' })).toBe('你好，张三！');
  });

  it('对象路径 {{user.name}}', () => {
    expect(renderDsl('{{user.name}}先生', { user: { name: '李四' } })).toBe('李四先生');
  });

  it('标签内空白容错 {{ name }}', () => {
    expect(renderDsl('{{ name }}', { name: '王五' })).toBe('王五');
  });

  it('数值与布尔字符串化', () => {
    expect(renderDsl('{{count}} / {{flag}}', { count: 42, flag: true })).toBe('42 / true');
  });

  it('缺失变量默认渲染为空', () => {
    expect(renderDsl('[{{missing}}]', {})).toBe('[]');
  });

  it('缺失变量 throw 模式抛 RenderError', () => {
    expect(() => renderDsl('{{missing}}', {}, { missingVar: 'throw' })).toThrow(RenderError);
    try {
      renderDsl('{{missing}}', {}, { missingVar: 'throw' });
    } catch (e) {
      expect((e as RenderError).code).toBe('unknown_var');
    }
  });
});

describe('DSL renderDsl - #if 条件块', () => {
  it('truthy 渲染块内容', () => {
    expect(renderDsl('{{#if show}}显示{{/if}}', { show: true })).toBe('显示');
  });

  it('falsy 跳过块内容', () => {
    expect(renderDsl('A{{#if show}}B{{/if}}C', { show: false })).toBe('AC');
  });

  it('缺失条件视为 falsy', () => {
    expect(renderDsl('{{#if nope}}B{{/if}}', {})).toBe('');
  });

  it('not. 反向条件', () => {
    expect(renderDsl('{{#if not.hidden}}显示{{/if}}', { hidden: false })).toBe('显示');
    expect(renderDsl('{{#if not.hidden}}显示{{/if}}', { hidden: true })).toBe('');
  });

  it('空字符串视为 falsy', () => {
    expect(renderDsl('{{#if name}}有{{/if}}', { name: '' })).toBe('');
  });

  it('非空数组视为 truthy，空数组视为 falsy', () => {
    expect(renderDsl('{{#if items}}有{{/if}}', { items: [1] })).toBe('有');
    expect(renderDsl('{{#if items}}有{{/if}}', { items: [] })).toBe('');
  });
});

describe('DSL renderDsl - #each 循环', () => {
  it('字符串数组用 {{this}}', () => {
    const tpl = '{{#each items}}- {{this}}\n{{/each}}';
    expect(renderDsl(tpl, { items: ['甲', '乙'] })).toBe('- 甲\n- 乙\n');
  });

  it('对象数组用 {{this.field}}', () => {
    const tpl = '{{#each claims}}第{{this.no}}项：{{this.text}}；\n{{/each}}';
    const vars = {
      claims: [
        { no: 1, text: '还款' },
        { no: 2, text: '赔礼' },
      ],
    };
    expect(renderDsl(tpl, vars)).toBe('第1项：还款；\n第2项：赔礼；\n');
  });

  it('对象数组裸字段访问', () => {
    const tpl = '{{#each rows}}[{{no}}]{{/each}}';
    const vars = { rows: [{ no: 'A' }, { no: 'B' }] };
    expect(renderDsl(tpl, vars)).toBe('[A][B]');
  });

  it('each 内裸字段优先取当前项，再回退外层', () => {
    const tpl = '{{#each rows}}{{outer}}-{{val}}\n{{/each}}';
    const vars = { outer: 'X', rows: [{ val: 1 }, { val: 2 }] };
    expect(renderDsl(tpl, vars)).toBe('X-1\nX-2\n');
  });

  it('空数组跳过', () => {
    expect(renderDsl('A{{#each items}}B{{/each}}C', { items: [] })).toBe('AC');
  });

  it('缺失 list 视为空（不抛错）', () => {
    expect(renderDsl('{{#each items}}B{{/each}}', {})).toBe('');
  });
});

describe('DSL renderDsl - 嵌套与深度', () => {
  it('#if 内嵌 #each', () => {
    const tpl = '{{#if show}}{{#each items}}{{this}}{{/each}}{{/if}}';
    expect(renderDsl(tpl, { show: true, items: ['a', 'b'] })).toBe('ab');
  });

  it('多层 #each 嵌套（深度 3）', () => {
    const tpl = '{{#each a}}{{#each b}}{{this}}-{{/each}}|{{/each}}';
    const vars = { a: [{ b: ['x', 'y'] }, { b: ['z'] }] };
    expect(renderDsl(tpl, vars)).toBe('x-y-|z-|');
  });

  it('深度 = 5（MAX_DEPTH）正常渲染', () => {
    // 5 层嵌套 each，每层展开 1 项
    let tpl = 'C';
    for (let i = 0; i < 5; i++) tpl = `{{#each l${i}}}${tpl}{{/each}}`;
    const vars = { l0: [1], l1: [1], l2: [1], l3: [1], l4: [1] };
    expect(renderDsl(tpl, vars)).toBe('C');
  });

  it('深度 > 5 抛 RenderError(max_depth)', () => {
    let tpl = 'C';
    for (let i = 0; i < 6; i++) tpl = `{{#each l${i}}}${tpl}{{/each}}`;
    expect(() => renderDsl(tpl, { l0: [1], l1: [1], l2: [1], l3: [1], l4: [1], l5: [1] })).toThrow(
      RenderError,
    );
    try {
      renderDsl(tpl, { l0: [1], l1: [1], l2: [1], l3: [1], l4: [1], l5: [1] });
    } catch (e) {
      expect((e as RenderError).code).toBe('max_depth');
    }
  });
});

describe('DSL renderDsl - 错误场景', () => {
  it('未闭合 #each 抛 unclosed_block', () => {
    expect(() => renderDsl('{{#each items}}X', { items: [1] })).toThrow(RenderError);
    try {
      renderDsl('{{#each items}}X', { items: [1] });
    } catch (e) {
      expect((e as RenderError).code).toBe('unclosed_block');
    }
  });

  it('未闭合 #if 抛 unclosed_block', () => {
    expect(() => renderDsl('{{#if x}}Y', { x: true })).toThrow(RenderError);
  });

  it('不匹配的闭合标签抛 invalid_block', () => {
    expect(() => renderDsl('{{#if x}}Y{{/each}}', { x: true })).toThrow(RenderError);
    try {
      renderDsl('{{#if x}}Y{{/each}}', { x: true });
    } catch (e) {
      expect((e as RenderError).code).toBe('invalid_block');
    }
  });

  it('多余闭合标签抛 invalid_block', () => {
    expect(() => renderDsl('X{{/if}}', {})).toThrow(RenderError);
  });
});

describe('DSL validateVars', () => {
  const schema: VarSchema[] = [
    { name: 'name', type: 'string', required: true, maxLength: 50 },
    { name: 'age', type: 'number' },
    { name: 'phone', type: 'string', format: '^1\\d{10}$' },
    { name: 'sign_date', type: 'date', required: true },
  ];

  it('全部合法 → valid:true', () => {
    const r = validateVars(schema, {
      name: '张三',
      age: 30,
      phone: '13800138000',
      sign_date: '2026-07-25',
    });
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('缺失必填 → required issue', () => {
    const r = validateVars(schema, { sign_date: '2026-07-25' });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === 'required' && i.field === 'name')).toBe(true);
  });

  it('可选字段缺失不报错', () => {
    const r = validateVars(schema, { name: '张三', sign_date: '2026-07-25' });
    expect(r.valid).toBe(true);
  });

  it('类型错误 → type issue', () => {
    const r = validateVars(schema, { name: '张三', age: '三十', sign_date: '2026-07-25' });
    expect(r.issues.some((i) => i.code === 'type' && i.field === 'age')).toBe(true);
  });

  it('maxLength 超限 → maxLength issue', () => {
    const r = validateVars(schema, { name: '张'.repeat(60), sign_date: '2026-07-25' });
    expect(r.issues.some((i) => i.code === 'maxLength' && i.field === 'name')).toBe(true);
  });

  it('format 不匹配 → format issue', () => {
    const r = validateVars(schema, { name: '张三', phone: 'abc', sign_date: '2026-07-25' });
    expect(r.issues.some((i) => i.code === 'format' && i.field === 'phone')).toBe(true);
  });

  it('date 类型校验', () => {
    const r = validateVars([{ name: 'd', type: 'date', required: true }], { d: '2026/07/25' });
    expect(r.issues.some((i) => i.code === 'type' && i.field === 'd')).toBe(true);
  });

  it('list 递归校验 itemSchema', () => {
    const schema: VarSchema[] = [
      {
        name: 'claims',
        type: 'list',
        required: true,
        itemSchema: [{ name: 'text', type: 'string', required: true }],
      },
    ];
    const r = validateVars(schema, { claims: [{ text: '还款' }, { text: '' }] });
    expect(r.issues.some((i) => i.code === 'required' && i.field === 'claims[1].text')).toBe(true);
  });

  it('party_group 递归校验 fields', () => {
    const schema: VarSchema[] = [
      {
        name: 'plaintiff',
        type: 'party_group',
        required: true,
        fields: [
          { name: 'name', type: 'string', required: true },
          { name: 'id_no', type: 'string', required: true, maxLength: 18 },
        ],
      },
    ];
    const r = validateVars(schema, { plaintiff: { name: '张三' } });
    expect(r.issues.some((i) => i.code === 'required' && i.field === 'plaintiff.id_no')).toBe(true);
  });

  it('vars 为 null/undefined 不抛错（按空对象处理）', () => {
    const r = validateVars(
      [{ name: 'name', type: 'string', required: true }],
      null as unknown as Record<string, unknown>,
    );
    expect(r.issues.some((i) => i.code === 'required')).toBe(true);
  });
});
