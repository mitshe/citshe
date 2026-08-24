import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES } from './queues';

// Processors
import { TaskQueueProcessor } from './processors/task-queue.processor';
import { SchedulesProcessor } from './processors/schedules.processor';

// Dependencies
import { TasksModule } from '../../modules/tasks/tasks.module';
import { PrismaModule } from '../persistence/prisma/prisma.module';

@Module({
  imports: [
    // The orchestrator worker queue (task-queue: runs QUEUED tasks in Claude
    // Code session containers — the ONLY execution path).
    BullModule.registerQueue({ name: QUEUES.TASK_QUEUE }),
    // Recurring schedules ("crons"): repeatable jobs → create a Task on fire.
    BullModule.registerQueue({ name: QUEUES.SCHEDULES }),

    // Dependencies for processors
    TasksModule,
    PrismaModule,
  ],
  // TaskQueueProcessor depends on OrchestrationService, provided by the global
  // McpModule.
  providers: [TaskQueueProcessor, SchedulesProcessor],
  exports: [BullModule],
})
export class QueueModule {}
