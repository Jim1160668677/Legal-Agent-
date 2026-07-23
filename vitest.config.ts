import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'],
  },
  esbuild: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    retry: 0,
    // 顺序执行测试文件：集成测试调用真实 Agnes API，免费用户有速率限制，
    // 并发文件执行会触发 429。单测很快，顺序执行不影响总耗时。
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/types/**', 'src/scripts/**']
    }
  }
});
