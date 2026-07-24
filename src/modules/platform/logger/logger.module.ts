/**
 * LoggerModule —— 注册 AppLoggerService（A1-W2）。
 *
 * 依赖 nestjs-pino 提供 JSON 行格式 logger；dev 环境 prettyPrint 便于调试。
 * PinoLogger 由 PinoLoggerModule.forRootAsync 注入，AppLoggerService 直接消费。
 *
 * 设计依据：A1 §6.4；02 §8.1 日志字段。
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { AppLoggerService } from './logger.service';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('LOG_LEVEL') ?? 'info',
          // 生产环境用 JSON 行；dev 用 pretty 提升可读性
          transport:
            process.env.NODE_ENV === 'dev'
              ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
              : undefined,
          // 关闭默认的 autoLogging，避免与 ResponseInterceptor 重复打 access log
          autoLogging: false,
          customLogLevel: () => 'info',
          serializers: {
            req: (r: { method?: string; url?: string }) => ({
              method: r.method,
              url: r.url,
            }),
          },
        },
      }),
    }),
  ],
  providers: [AppLoggerService],
  exports: [AppLoggerService],
})
export class LoggerModule {}
