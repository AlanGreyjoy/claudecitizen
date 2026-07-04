import 'dotenv/config';
import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { Logger } from 'nestjs-pino';
import pino from 'pino';
import { AppModule } from './app.module';
import { EnvService } from './shared/env.service';

const bootstrapLogger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
});

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  const env = app.get(EnvService);

  app.use(cookieParser());
  app.enableCors({
    credentials: true,
    origin: env.clientOrigin,
  });
  app.useWebSocketAdapter(new WsAdapter(app));

  await app.listen(env.port, '0.0.0.0');
  logger.log({ port: env.port }, 'ClaudeCitizen backend listening');
}

bootstrap().catch((error) => {
  bootstrapLogger.error({ err: error }, 'ClaudeCitizen backend failed to start');
  process.exitCode = 1;
});
