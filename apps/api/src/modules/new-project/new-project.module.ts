import { Module } from '@nestjs/common';
import { NewProjectController } from './new-project.controller';
import { NewProjectService } from './new-project.service';

/**
 * The "New project" wizard's single atomic endpoint. Depends only on global
 * providers (Prisma, AdapterFactoryService, OrchestrationService).
 */
@Module({
  controllers: [NewProjectController],
  providers: [NewProjectService],
})
export class NewProjectModule {}
