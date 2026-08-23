import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES, ScheduleJob } from '../queues';
import { PrismaService } from '../../persistence/prisma/prisma.service';
import { TasksService } from '../../../modules/tasks/services/tasks.service';

/**
 * Fires when a Schedule's BullMQ repeatable job triggers. Creates a Task from
 * the schedule's stored prompt/repo/delivery so it runs through the normal
 * queue → worker → PR flow, and stamps lastRunAt. A disabled/deleted schedule
 * is a no-op (the repeatable should already be removed, but we double-check).
 */
@Processor(QUEUES.SCHEDULES)
export class SchedulesProcessor extends WorkerHost {
  private readonly logger = new Logger(SchedulesProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
  ) {
    super();
  }

  async process(job: Job<ScheduleJob>): Promise<void> {
    const { scheduleId } = job.data;
    const schedule = await this.prisma.schedule.findUnique({
      where: { id: scheduleId },
    });
    if (!schedule || !schedule.enabled) {
      this.logger.debug(`Schedule ${scheduleId} missing/disabled — skipping.`);
      return;
    }

    const task = await this.tasksService.create(
      schedule.organizationId,
      schedule.createdBy,
      {
        title: schedule.name,
        description: schedule.prompt,
        repositoryId: schedule.repositoryId ?? undefined,
        deliveryMode: schedule.deliveryMode,
        labels: ['scheduled'],
      },
    );

    await this.prisma.schedule.update({
      where: { id: scheduleId },
      data: { lastRunAt: new Date() },
    });

    this.logger.log(
      `Schedule ${scheduleId} fired → created task ${task.id} (${schedule.name}).`,
    );
  }
}
