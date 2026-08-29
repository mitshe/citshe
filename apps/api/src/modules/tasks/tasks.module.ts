import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TasksController } from './controllers/tasks.controller';
import { WorkerTasksController } from './controllers/worker-tasks.controller';
import { TasksService } from './services/tasks.service';
import { TaskComposerService } from './services/task-composer.service';
import { SchedulesModule } from '../schedules/schedules.module';

@Module({
  imports: [CqrsModule, SchedulesModule],
  controllers: [TasksController, WorkerTasksController],
  providers: [TasksService, TaskComposerService],
  exports: [TasksService],
})
export class TasksModule {}
