/**
 * Vercel Serverless Function 入口
 * 
 * 这是法律智能体 API 的 Vercel Serverless 部署入口。
 * 路由规则在 vercel.json 中配置，所有 /v1/* 请求会转发到此处。
 * 
 * 使用方法：
 * 1. npm install  # 安装依赖
 * 2. vercel       # 部署到 Vercel
 */

import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';

// 缓存应用实例，避免冷启动时重复初始化
let cachedApp: INestApplication | null = null;
let cachedServer: Server | null = null;

/**
 * 初始化 NestJS 应用
 */
async function initApp() {
  if (cachedApp) {
    return { app: cachedApp, server: cachedServer };
  }

  const app = await NestFactory.create(AppModule, { 
    bufferLogs: true,
  });

  // CORS 配置
  const corsOrigins = process.env.CORS_ORIGINS?.split(',') || [];
  if (corsOrigins.length > 0) {
    app.enableCors({ origin: corsOrigins });
  } else {
    app.enableCors({ origin: false });
  }

  // 全局参数校验
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 全局异常过滤器
  app.useGlobalFilters(new HttpExceptionFilter());

  // 全局响应拦截器
  app.useGlobalInterceptors(new ResponseInterceptor());

  // 获取底层 HTTP Server
  const server = app.getHttpServer();

  cachedApp = app;
  cachedServer = server;

  return { app, server };
}

/**
 * Vercel Serverless Function 主入口
 * 
 * @param request Vercel 请求对象
 * @param response Vercel 响应对象
 */

/** Vercel Serverless 请求/响应的最小结构（未安装 @vercel/node 类型时使用） */
interface VercelRequest {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, string | string[]>;
}

interface VercelResponse {
  headersSent: boolean;
  status(code: number): VercelResponse;
  json(body: unknown): void;
  on(event: string, listener: () => void): VercelResponse;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    const { server } = await initApp();

    // 将 Vercel 的请求/响应传递给 NestJS 的 HTTP Server
    await new Promise<void>((resolve) => {
      server.emit('request', request, response);
      response.on('finish', resolve);
      response.on('close', resolve);
      response.on('error', resolve);
    });
  } catch (error) {
    console.error('[Vercel] Serverless function error:', error);

    if (!response.headersSent) {
      response.status(500).json({
        code: 500,
        message: 'Internal Server Error',
        traceId: '',
        data: null,
      });
    }
  }
}
