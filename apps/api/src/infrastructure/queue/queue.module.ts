import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES } from './queues';

// Processors
import { TaskProcessingProcessor } from './processors/task-processing.processor';

// Dependencies
import { TasksModule } from '../../modules/tasks/tasks.module';
import { PrismaModule } from '../persistence/prisma/prisma.module';

@Module({
  imports: [
    // Register the task-processing queue
    BullModule.registerQueue({ name: QUEUES.TASK_PROCESSING }),

    // Dependencies for processors
    TasksModule,
    PrismaModule,
  ],
  providers: [TaskProcessingProcessor],
  exports: [BullModule],
})
export class QueueModule {}
