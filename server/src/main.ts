import 'dotenv/config';
import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { EnvService } from './shared/env.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const env = app.get(EnvService);

  app.use(cookieParser());
  app.enableCors({
    credentials: true,
    origin: env.clientOrigin,
  });
  app.useWebSocketAdapter(new WsAdapter(app));

  await app.listen(env.port, '0.0.0.0');
  console.log(`ClaudeCitizen backend listening on :${env.port}`);
}

bootstrap().catch((error) => {
  console.error('ClaudeCitizen backend failed to start.', error);
  process.exitCode = 1;
});
