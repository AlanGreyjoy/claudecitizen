import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { EnvService } from '../shared/env.service';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(EnvService) env: EnvService,
    @InjectPinoLogger(PrismaService.name) private readonly logger: PinoLogger,
  ) {
    super({
      adapter: new PrismaPg({ connectionString: env.databaseUrl }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.info('Database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.info('Database disconnected');
  }
}
