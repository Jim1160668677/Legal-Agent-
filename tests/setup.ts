/**
 * vitest 全局 setup（A1-W2）。
 *
 * 加载 reflect-metadata，使 @nestjs/mongoose 的 @Prop 装饰器能在测试环境
 * 正确推断字段类型（生产环境由 main.ts 顶部 import 'reflect-metadata' 完成）。
 */
import 'reflect-metadata';
