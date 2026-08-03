/**
 * fix-import-type-v2.js —— 精准修复 import type → value import（基于 constructor 参数类型）。
 *
 * 背景：v2.3 阶段十的 fix-import-type.js 只覆盖 `.service` 后缀和 @nestjs/config/@nestjs/core，
 * 漏掉了 nestjs-pino（PinoLogger）、@nestjs/jwt（JwtService）、AgentRegistry、Model 等模块的 DI token。
 * 这些文件在 dev 模式（@swc-node/register）下能工作（swc 对 import type 保留运行时引用），
 * 但生产模式（tsc 编译）下 import type 被完全擦除，design:paramtypes 记录为 Function/Object，
 * NestJS 抛 "can't resolve dependencies of the X (?)"。
 *
 * 本脚本策略：
 *   1. 扫描 src/ 下所有 .ts 文件
 *   2. 对每个文件，提取所有 `import type { A, B } from 'M'` 的标识符
 *   3. 用正则匹配文件的 constructor 参数列表，提取参数类型注解
 *   4. 如果 import type 的标识符出现在 constructor 参数类型中，改为 value import
 *   5. 混合 import 自动拆分为两行（value import + import type）
 *
 * 安全保证：
 *   - 只改「在 constructor 参数类型注解中出现的」标识符，其他保持 import type
 *   - 红线文件（llm.ts / cache.service.ts 等）跳过
 *
 * 用法：node scripts/fix-import-type-v2.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const DRY_RUN = process.argv.includes('--dry-run');

/** 红线文件（不可修改）。路径相对 src/，匹配 rel.startsWith(p) */
const REDLIST = [
  // legacy LlmService 单文件 + provider/registry/errors 子模块
  'services/legal/llm.ts',
  'services/legal/llm/',
  // LLM 类型契约
  'types/llm.ts',
  // Redis 缓存（红线）
  'modules/platform/cache/cache.service.ts',
  // 系统 schema（红线）
  'infra/database/schemas/system.schema.ts',
];

/** 递归收集所有 .ts 文件 */
function collectTsFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsFiles(full, acc);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

/** 是否在红线列表中 */
function isRedlisted(filePath) {
  const rel = path.relative(SRC_DIR, filePath).replace(/\\/g, '/');
  return REDLIST.some((p) => rel === p || rel.startsWith(p));
}

/**
 * 提取文件中所有 constructor 参数的类型注解标识符。
 * 匹配模式：constructor(... 参数 ...)，参数形如 `private readonly x: Type` 或 `x: Type`
 * 返回 Set<string>，如 {'PinoLogger', 'ConfigService', 'AgentRegistry'}
 */
function extractConstructorTypes(content) {
  const types = new Set();
  // 匹配 constructor 关键字后的圆括号内容（支持多行参数）
  // 简化：找 constructor(...) 的整个参数列表
  const ctorRegex = /constructor\s*\(([\s\S]*?)\)\s*\{/g;
  let m;
  while ((m = ctorRegex.exec(content)) !== null) {
    const params = m[1];
    // 匹配每个参数的类型注解：`name: Type` 或 `name?: Type`
    // Type 可以是标识符、泛型、数组等；这里只取首字母大写的标识符（DI token 通常是类）
    const annotRegex = /:\s*([A-Z][A-Za-z0-9_]*)/g;
    let a;
    while ((a = annotRegex.exec(params)) !== null) {
      types.add(a[1]);
    }
  }
  return types;
}

/** 处理单文件 */
function processFile(filePath) {
  if (isRedlisted(filePath)) return false;
  const content = fs.readFileSync(filePath, 'utf8');
  const ctorTypes = extractConstructorTypes(content);
  if (ctorTypes.size === 0) return false;

  const lines = content.split('\n');
  let changed = false;
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 匹配 import type { A, B } from '...'
    const m = line.match(/^(\s*)import type \{([^}]+)\} from (['"][^'"]+['"]);?\s*$/);
    if (!m) {
      result.push(line);
      continue;
    }

    const indent = m[1];
    const fromModule = m[3];
    // 解析标识符（可能含 `as` 别名，如 `X as Y`）
    const rawNames = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    const names = rawNames.map((n) => {
      // 处理 `X as Y`：原类名是 X（从模块导出），别名 Y 是本地名
      const asMatch = n.match(/^(\w+)\s+as\s+(\w+)$/);
      if (asMatch) return { original: asMatch[1], local: asMatch[2], raw: n };
      return { original: n, local: n, raw: n };
    });

    // 判断哪些标识符是 DI token（出现在 constructor 参数类型中）
    // 用 local 名（本地引用名）匹配
    const diTokens = names.filter((n) => ctorTypes.has(n.local));
    const pureTypes = names.filter((n) => !ctorTypes.has(n.local));

    if (diTokens.length === 0) {
      // 没有需要改的，保持原样
      result.push(line);
      continue;
    }

    // 需要改：把 diTokens 改为 value import，pureTypes 保留 import type
    const diRaw = diTokens.map((n) => n.raw).join(', ');
    if (pureTypes.length === 0) {
      // 全是 DI token，直接改 import type → import
      result.push(`${indent}import { ${diRaw} } from ${fromModule};`);
    } else {
      // 混合：拆分两行
      const typeRaw = pureTypes.map((n) => n.raw).join(', ');
      result.push(`${indent}import { ${diRaw} } from ${fromModule};`);
      result.push(`${indent}import type { ${typeRaw} } from ${fromModule};`);
    }
    changed = true;
  }

  if (changed) {
    if (!DRY_RUN) {
      fs.writeFileSync(filePath, result.join('\n'), 'utf8');
    }
    console.log(`${DRY_RUN ? '[DRY] ' : ''}FIXED: ${path.relative(process.cwd(), filePath)}`);
  }
  return changed;
}

// 主流程
const files = collectTsFiles(SRC_DIR);
let fixedCount = 0;
for (const f of files) {
  if (processFile(f)) fixedCount++;
}
console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Done. Fixed ${fixedCount} files out of ${files.length} scanned.`);
