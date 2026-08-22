import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES } from './queues';

// Processors
import { TaskProcessingProcessor } from './processors/task-processing.processor';
import { TaskQueueProcessor } from './processors/task-queue.processor';

// Dependencies
import { TasksModule } from '../../modules/tasks/tasks.module';
import { PrismaModule } from '../persistence/prisma/prisma.module';

@Module({
  imports: [
    // Register the task-processing queue (AI analysis) and the orchestrator
    // worker queue (task-queue: runs QUEUED tasks in session containers).
    BullModule.registerQueue({ name: QUEUES.TASK_PROCESSING }),
    BullModule.registerQueue({ name: QUEUES.TASK_QUEUE }),

    // Dependencies for processors
    TasksModule,
    PrismaModule,
  ],
  // TaskQueueProcessor depends on OrchestrationService, provided by the global
  // McpModule.
  providers: [TaskProcessingProcessor, TaskQueueProcessor],
  exports: [BullModule],
})
export class QueueModule {}
