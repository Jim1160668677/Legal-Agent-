# 工程脚手架搭建验证报告

> 搭建日期：2026-07-24 | 项目：legal-agent | 对应文档：A1 §三 NestJS 工程结构
> 目的：在启动 A1 实施前完成工程基础前置准备，建立版本控制 + 代码质量 + CI 流程

---

## 一、搭建范围与交付物

| # | 任务项 | 交付物 | 状态 |
|---|--------|--------|------|
| 1 | git 仓库初始化 | .git/ + .gitignore + 初始 commit | ✅ 完成 |
| 2 | ESLint 代码检查 | eslint.config.mjs + 依赖 | ✅ 完成 |
| 3 | Prettier 代码格式化 | .prettierrc.json + .prettierignore | ✅ 完成 |
| 4 | CI 持续集成流程 | .github/workflows/ci.yml | ✅ 完成 |
| 5 | package.json 脚本 | lint/format/format:check/typecheck/test:unit | ✅ 完成 |

---

## 二、版本控制体系

### 2.1 git 初始化

```
仓库路径：g:\智能体设计\legal-agent
初始 commit：852c061 chore: initialize legal-agent project scaffold
提交文件数：65
分支：master（本地）
```

### 2.2 .gitignore 配置（已忽略项）

```
node_modules/          # 依赖
dist/                  # 编译产物
.env                   # 真实密钥（不入仓库）
.env.local
.env.*.local
reports/               # 测试报告/覆盖率
*.log
.DS_Store
.vscode/
.idea/
coverage/
.trae/
# === scaffold ===
.env.dev               # 多环境密钥
.env.staging
.env.prod
*.tsbuildinfo          # TS 增量构建
.eslintcache           # ESLint 缓存
```

**安全验证**：`.env` 已被 git 忽略（`git check-ignore .env` 确认）；仅 `.env.example`（占位符 sk-xxx...）入库。

---

## 三、ESLint 配置

### 3.1 配置文件：eslint.config.mjs（flat config，ESLint 9）

```javascript
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', 'reports/', 'docs/'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // 测试与脚本允许 console（调试输出与性能报告）
    files: ['tests/**/*.ts', 'src/scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
```

### 3.2 规则说明

| 规则 | 级别 | 用途 |
|------|------|------|
| @typescript-eslint/no-unused-vars | error | 禁止未使用变量（_ 前缀豁免） |
| @typescript-eslint/no-explicit-any | warn | 警告 any 使用 |
| @typescript-eslint/consistent-type-imports | error | 强制 type-imports |
| no-console | warn（生产）/ off（测试脚本） | 生产代码禁 console.log |

### 3.3 验证结果

```
$ npm run lint
> eslint .

=== EXIT: 0 ===
0 errors, 0 warnings
```

---

## 四、Prettier 配置

### 4.1 配置文件：.prettierrc.json

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "endOfLine": "lf"
}
```

### 4.2 .prettierignore

```
dist/
node_modules/
coverage/
reports/
docs/
package-lock.json
```

### 4.3 验证结果

```
$ npm run format:check
> prettier --check "src/**/*.ts" "tests/**/*.ts"
All matched files use Prettier code style!

=== EXIT: 0 ===
```

**格式化修复记录**：首次运行发现 18 个文件不符合 Prettier 风格（src/config/*、src/services/legal/llm/*、tests/*），已通过 `npm run format` 自动修复，修复后全部通过。

---

## 五、CI 持续集成流程

### 5.1 配置文件：.github/workflows/ci.yml

```yaml
name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]
jobs:
  quality:
    name: Lint + Typecheck + Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run lint          # ESLint
      - run: npm run format:check  # Prettier
      - run: npm run typecheck     # tsc --noEmit
      - run: npm run test:unit     # vitest
```

### 5.2 触发条件

- push 到 main / develop 分支
- PR 到 main / develop 分支

### 5.3 质量门禁（4 道）

| 门禁 | 命令 | 通过标准 | 本地验证 |
|------|------|---------|---------|
| Lint | npm run lint | 0 errors | ✅ 0 errors, 0 warnings |
| Format | npm run format:check | All files conform | ✅ All matched files use Prettier code style |
| Typecheck | npm run typecheck | tsc --noEmit 无错误 | ✅ EXIT 0 |
| Unit tests | npm run test:unit | 全部通过 | ✅ 76 passed (6 files) |

---

## 六、package.json 脚本清单

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "smoke": "tsx src/scripts/agnes-smoke.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run tests/unit/",
    "test:agnes": "vitest run tests/integration/agnes/ tests/e2e/",
    "test:report": "vitest run --reporter=json --outputFile=reports/test-results.json",
    "lint": "eslint .",
    "format": "prettier --write \"src/**/*.ts\" \"tests/**/*.ts\"",
    "format:check": "prettier --check \"src/**/*.ts\" \"tests/**/*.ts\""
  }
}
```

### devDependencies 新增

| 包 | 版本 | 用途 |
|----|------|------|
| @eslint/js | ^9.0.0 | ESLint 推荐规则集 |
| eslint | ^9.0.0 | ESLint 核心（实测 v9.39.5） |
| typescript-eslint | ^8.0.0 | TS ESLint 解析器+规则 |
| prettier | ^3.0.0 | 代码格式化（实测 v3.9.6） |

---

## 七、本地全量验证结果

### 7.1 质量门禁逐项验证

| # | 验证项 | 命令 | 结果 | 退出码 |
|---|--------|------|------|--------|
| 1 | ESLint | npm run lint | 0 errors, 0 warnings | 0 ✅ |
| 2 | Prettier | npm run format:check | All matched files use Prettier code style | 0 ✅ |
| 3 | TypeScript | npm run typecheck | 无类型错误 | 0 ✅ |
| 4 | Unit tests | npm run test:unit | 76 passed (6 test files) | 0 ✅ |

### 7.2 单元测试明细

```
✓ tests/unit/errors.test.ts          (16 tests) 27ms
✓ tests/unit/config.test.ts          (17 tests) 13ms
✓ tests/unit/registry.test.ts        (14 tests) 11ms
✓ tests/unit/retry.test.ts           (11 tests) 220ms
✓ tests/unit/lawRefExtractor.test.ts (10 tests) 8ms
✓ tests/unit/sse.test.ts             (8 tests)  15ms

Test Files  6 passed (6)
     Tests  76 passed (76)
  Duration  3.55s
```

### 7.3 代码质量修复记录（脚手架搭建过程中）

| # | 问题 | 文件 | 修复方式 |
|---|------|------|---------|
| 1 | require-yield | src/services/legal/llm/qwenProvider.ts:34 | eslint-disable-next-line（桩实现有意无 yield） |
| 2 | no-unused-vars (5 处) | tests/integration/agnes/boundary.test.ts, exception.test.ts, tests/unit/errors.test.ts | 删除未使用的 import（InvalidRequestError/ApiError/NetworkError） |
| 3 | consistent-type-imports (3 处) | tests/unit/registry.test.ts 等 | eslint --fix 自动修复（import type） |
| 4 | .prettierrc.json BOM | .prettierrc.json | 移除 UTF-8 BOM，重写为有效 JSON |
| 5 | 18 文件格式不符 | src/**, tests/** | npm run format 自动修复 |

---

## 八、与 A1 文档的对应关系

| A1 §三目录结构 | 脚手架现状 | 备注 |
|---------------|-----------|------|
| src/main.ts | 待 A1 实施创建 | 脚手架阶段不创建业务代码 |
| src/app.module.ts | 待 A1 实施创建 | |
| src/config/ | ✅ 已有 env.ts/index.ts/types.ts | Agnes 集成阶段已建 |
| src/common/ | 待 A1 实施创建 | |
| src/modules/ | 待 A1 实施创建 | |
| src/infra/ | 待 A1 实施创建 | |
| src/data/ | 待 A1 实施创建 | |
| src/services/legal/llm/ | ✅ 已有完整 Agnes provider | 105 测试用例覆盖 |
| test/ → tests/ | ✅ 已有 unit/integration/e2e | vitest 配置就绪 |

**结论**：脚手架阶段已建立工程基础设施（版本控制+质量工具+CI），A1 实施时可直接在现有结构上创建 NestJS 业务代码，无需重建工程。

---

## 九、后续建议

1. **CI 远程验证**：本次为本地验证，建议首次 push 到 GitHub 后确认 CI workflow 实际触发并通过
2. **Husky pre-commit hook**（可选）：可在后续追加 husky + lint-staged，实现 commit 前自动 lint+format，本次未引入以保持脚手架轻量
3. **commitlint**（可选）：如需强制 conventional commits 规范，可在后续追加
4. **test:agnes 集成测试**：需 AGNES_API_KEY 环境变量，CI 中应作为单独 job（secrets 注入），不纳入默认 quality job

---

## 十、验证结论

**所有配置正确生效**。工程脚手架搭建完成，4 道质量门禁全部通过，git 版本控制体系建立（初始 commit 852c061），可进入 A1 NestJS 业务代码实施阶段。