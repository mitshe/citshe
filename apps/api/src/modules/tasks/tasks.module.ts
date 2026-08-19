import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { BullModule } from '@nestjs/bullmq';
import { TasksController } from './controllers/tasks.controller';
import { TasksService } from './services/tasks.service';
import { TaskComposerService } from './services/task-composer.service';
import { QUEUES } from '@/infrastructure/queue/queues';

@Module({
  imports: [
    CqrsModule,
    BullModule.registerQueue({ name: QUEUES.TASK_PROCESSING }),
  ],
  controllers: [TasksController],
  providers: [TasksService, TaskComposerService],
  exports: [TasksService],
})
export class TasksModule {}
