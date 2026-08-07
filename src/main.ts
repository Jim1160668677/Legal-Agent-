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
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // 用 pino 替换 NestJS 默认 Logger，使框架内部日志也走结构化输出
  app.useLogger(app.get(PinoLogger));

  const config = app.get(ConfigService);

  // 安全头
  app.use(helmet());

  // CORS：空白名单 = 禁止跨域（拒绝任意源反射）；非空 = 仅白名单
  const corsOrigins = config.get<string[]>('app.cors.origins') ?? [];
  app.enableCors(corsOrigins.length > 0 ? { origin: corsOrigins } : { origin: false });

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

  // 优雅停机：SIGTERM/SIGINT 触发 onModuleDestroy，让 mongoose/redis 优雅断开（Phase 1.3）
  // 生产容器（Docker/k8s/systemd）发 SIGTERM 时，避免连接泄漏与在途请求被硬中断
  app.enableShutdownHooks();

  // Swagger 文档：仅 SWAGGER_ENABLED=true 且非生产环境时挂载（生产强制关闭，避免暴露 API schema）
  // 注意：NODE_ENV 合法值为 dev/staging/prod（见 validation.schema.ts），生产为 'prod'
  const swaggerEnabled =
    config.get<boolean>('app.swagger.enabled') === true && process.env.NODE_ENV !== 'prod';
  if (swaggerEnabled) {
    const swaggerPath = config.get<string>('app.swagger.path') ?? '/docs';
    const swaggerConfig = new DocumentBuilder()
      .setTitle('legal-agent')
      .setDescription('NestJS 法律 Agent 服务 API（12 Agent + 意图路由 + 混合检索 + 文书生成）')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(swaggerPath, app, document);
  }

  const port = process.env.PORT ?? '3000';
  const isLocal = process.env.NODE_ENV === 'local';
  const logger = new Logger('Bootstrap');

  if (isLocal) {
    logger.log('Running in LOCAL mode - JWT auth disabled, CORS open to localhost');
    logger.log(`Server running on http://localhost:${port}`);
    logger.log(
      `Swagger UI: http://localhost:${port}${config.get<string>('app.swagger.path') ?? '/docs'}`,
    );
  }

  await app.listen(port);

  if (!isLocal) {
    logger.log(`legal-agent NestJS service listening on :${port}`);
    logger.log(`health check: GET http://localhost:${port}/health`);
    if (swaggerEnabled) {
      logger.log(
        `swagger UI: http://localhost:${port}${config.get<string>('app.swagger.path') ?? '/docs'}`,
      );
    }
  }
}

bootstrap().catch((err: unknown) => {
  // bootstrap 失败在 Logger 初始化之前，只能 fallback 到 stderr
  process.stderr.write(
    JSON.stringify({ level: 'fatal', msg: 'Failed to bootstrap NestJS app', error: String(err) }) +
      '\n',
  );
  process.exit(1);
});
