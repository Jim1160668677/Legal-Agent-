import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'dist/',
      'node_modules/',
      'coverage/',
      'reports/',
      'docs/',
      // scripts/*.js 是 CommonJS 工具脚本（require/__dirname/console 是合理的），
      // 不应走 TS ESLint 规则
      'scripts/**/*.js',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      // consistent-type-imports：关闭。
      // 原因：NestJS DI 依赖 reflect-metadata 的 design:paramtypes，constructor 参数
      // `private x: Foo` 中的 Foo 必须是 value import（作为 DI token）；import type 会被
      // tsc 编译器擦除导致 design:paramtypes = Object/Function，prod 模式（tsc 编译）DI 抛
      // "can't resolve dependencies"。dev 模式（@swc-node/register）下 swc 保留运行时引用
      // 不受影响，但 prod 模式（node dist/main.js）必须 value import。
      // 该规则要求「纯类型用改 import type」，与 NestJS DI 的 value import 需求根本冲突，
      // 且 @Inject/@InjectModel 装饰器注入的参数也常被误报。NestJS 官方 ESLint 配置
      // （@nestjs/eslint-config）默认不启用此规则。
      // 详见 project_memory §17 + Phase 2.10 验证（docker prod 模式 DI 失败）。
      '@typescript-eslint/consistent-type-imports': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // 测试与脚本允许 console（用于调试输出与性能报告）
    files: ['tests/**/*.ts', 'src/scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);