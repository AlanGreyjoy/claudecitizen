import type { Params } from 'nestjs-pino';
import type { EnvService } from './env.service';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.token',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
];

export function createLoggerParams(env: EnvService): Params {
  return {
    pinoHttp: {
      level: env.logLevel,
      redact: {
        paths: REDACT_PATHS,
        censor: '[Redacted]',
      },
      ...(env.isProduction
        ? {}
        : {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                singleLine: true,
              },
            },
          }),
    },
  };
}
