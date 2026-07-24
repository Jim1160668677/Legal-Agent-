/**
 * NestJS 应用启动入口（A1-W1 + A1-W2 扩展）。
 *
 * bootstrap：
 *   helmet（安全头）+ cors + ValidationPipe（全局参数校验）
 *   + HttpExceptionFilter（全局异常→统一信封）
 *   + ResponseInterceptor（全局响应→统一信封）
 *   + NestPino（替换默认 Logger，结构化 JSON 日志）
 *
 * TraceContext 中间件在 AppModule.configure 中注册（forRoutes('*')）。
 *
 * 设计依据：A1 §三 main.ts + §6.4 Logger。
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // 用 pino 替换 NestJS 默认 Logger，使框架内部日志也走结构化输出
  app.useLogger(app.get(PinoLogger));

  // 安全头
  app.use(helmet());

  // CORS（A1 阶段开放所有源；A5 接入外部 agent 时收紧白名单）
  app.enableCors();

  // 全局参数校验：whitelist 剥离未声明字段，transform 自动类型转换
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 全局异常 → 统一信封
  app.useGlobalFilters(new HttpExceptionFilter());

  // 全局响应 → 统一信封（SSE 自动放行）
  app.useGlobalInterceptors(new ResponseInterceptor());

  const port = process.env.PORT ?? '3000';
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`legal-agent NestJS service listening on :${port}`);
  logger.log(`health check: GET http://localhost:${port}/health`);
}

bootstrap().catch((err: unknown) => {
  console.error('Failed to bootstrap NestJS app:', err);
  process.exit(1);
});
