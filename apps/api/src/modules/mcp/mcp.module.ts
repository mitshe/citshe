import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OrchestrationService } from './orchestration/orchestration.service';
import { OrchestrationController } from './orchestration/orchestration.controller';
import { TasksModule } from '../tasks/tasks.module';
import { QUEUES } from '@/infrastructure/queue/queues';

/**
 * Orchestration: the task queue and worker dispatch that sit behind the Tasks
 * UI. (The former conversational MCP tool-loop was removed with the chat
 * surface — workers are driven from the queue, not a chat agent.)
 */
@Global()
@Module({
  imports: [
    TasksModule,
    // OrchestrationService enqueues/reprioritizes jobs on the worker queue.
    BullModule.registerQueue({ name: QUEUES.TASK_QUEUE }),
  ],
  controllers: [OrchestrationController],
  providers: [OrchestrationService],
  exports: [OrchestrationService],
})
export class McpModule {}
