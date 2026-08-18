import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { EventHandlers } from './events/handlers';
import { PrismaModule } from '../infrastructure/persistence/prisma/prisma.module';
import { AdaptersModule } from '../infrastructure/adapters/adapters.module';

/**
 * Application Layer Module
 *
 * Contains CQRS handlers for:
 * - Commands (write operations)
 * - Queries (read operations)
 * - Events (side effects)
 */
@Module({
  imports: [CqrsModule, PrismaModule, AdaptersModule],
  providers: [...EventHandlers],
  exports: [...EventHandlers],
})
export class ApplicationModule {}
