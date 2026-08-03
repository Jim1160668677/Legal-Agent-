/**
 * 批量修复 import type → import（仅对 @Injectable() DI 注入类）。
 *
 * 原理：@swc-node/register 开启 emitDecoratorMetadata 后，NestJS DI 依赖
 * reflect-metadata 的 design:paramtypes 来识别构造函数参数类型。
 * 但 import type 会被编译器擦除，导致 design:paramtypes 记录为 Object，
 * NestJS 抛 "Nest can't resolve dependencies of the X (?, Object)"。
 *
 * 本脚本：
 *   1. 扫描 src/ 下所有 .ts 文件
 *   2. 找到 import type { ... } from '....service' 等导入
 *   3. 将类名（后缀匹配）改为值导入，类型名保留 import type
 *   4. 混合导入自动拆分为两行
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');

/** DI 注入类的后缀模式 */
const CLASS_SUFFIXES = [
  'Service', 'Guard', 'Monitor', 'Router', 'Manager', 'Scorer', 'Tracer',
  'Builder', 'Retriever', 'Provider', 'Breaker', 'Extractor', 'Splitter',
  'Reasoner', 'Determiner', 'Comparator', 'Controller', 'Strategy',
];

/** 判断名称是否为 DI 注入类（按后缀） */
function isDiClass(name) {
  return CLASS_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

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

/** 处理单文件 */
function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let changed = false;
  const result = [];

  for (const line of lines) {
    // 匹配 import type { A, B } from '...'
    const m = line.match(/^(\s*)import type \{([^}]+)\} from (['"][^'"]+['"]);?\s*$/);
    if (!m) {
      result.push(line);
      continue;
    }

    const indent = m[1];
    const fromModule = m[3];
    const names = m[2].split(',').map((s) => s.trim()).filter(Boolean);

    // 只处理从 .service / @nestjs/config / @nestjs/core 导入的情况
    const isServiceImport =
      fromModule.includes('.service') ||
      fromModule.includes("'.service") ||
      fromModule.includes('@nestjs/config') ||
      fromModule.includes('@nestjs/core');

    if (!isServiceImport) {
      result.push(line);
      continue;
    }

    // 特殊处理：@nestjs/core 只修 Reflector
    if (fromModule.includes('@nestjs/core')) {
      const hasReflector = names.includes('Reflector');
      if (!hasReflector) {
        result.push(line);
        continue;
      }
      // Reflector 是类，其余可能是类型
      const classes = names.filter((n) => n === 'Reflector');
      const types = names.filter((n) => n !== 'Reflector');
      if (types.length === 0) {
        result.push(`${indent}import { Reflector } from ${fromModule};`);
      } else {
        result.push(`${indent}import { Reflector } from ${fromModule};`);
        result.push(`${indent}import type { ${types.join(', ')} } from ${fromModule};`);
      }
      changed = true;
      continue;
    }

    // 分离类名和类型名
    const classes = names.filter(isDiClass);
    const types = names.filter((n) => !isDiClass(n));

    if (classes.length === 0) {
      // 全是类型，保持不变
      result.push(line);
      continue;
    }

    if (types.length === 0) {
      // 全是类，直接改 import type → import
      result.push(`${indent}import { ${classes.join(', ')} } from ${fromModule};`);
    } else {
      // 混合：拆分为两行
      result.push(`${indent}import { ${classes.join(', ')} } from ${fromModule};`);
      result.push(`${indent}import type { ${types.join(', ')} } from ${fromModule};`);
    }
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, result.join('\n'), 'utf8');
    console.log(`FIXED: ${path.relative(process.cwd(), filePath)}`);
  }
  return changed;
}

// 主流程
const files = collectTsFiles(SRC_DIR);
let fixedCount = 0;
for (const f of files) {
  if (processFile(f)) fixedCount++;
}
console.log(`\nDone. Fixed ${fixedCount} files out of ${files.length} scanned.`);
