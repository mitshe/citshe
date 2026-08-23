import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';
import { QUEUES, ScheduleJob } from '../../../infrastructure/queue/queues';
import { CreateScheduleDto, UpdateScheduleDto } from '../dto/schedule.dto';
import { Schedule } from '@prisma/client';

/**
 * CRUD for recurring schedules ("crons"), kept in sync with BullMQ job
 * schedulers. Each enabled schedule owns one job scheduler keyed by its id
 * (`sched:<id>`); when it fires, {@link SchedulesProcessor} creates a Task.
 * Disabling or deleting a schedule removes its scheduler.
 */
@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.SCHEDULES)
    private readonly queue: Queue<ScheduleJob>,
  ) {}

  private schedulerId(id: string): string {
    return `sched:${id}`;
  }

  async findAll(organizationId: string) {
    return this.prisma.schedule.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: { repository: { select: { id: true, name: true } } },
    });
  }

  async create(organizationId: string, userId: string, dto: CreateScheduleDto) {
    const schedule = await this.prisma.schedule.create({
      data: {
        organizationId,
        createdBy: userId,
        name: dto.name,
        prompt: dto.prompt,
        cron: dto.cron,
        timezone: dto.timezone || 'Europe/Warsaw',
        repositoryId: dto.repositoryId || null,
        deliveryMode: dto.deliveryMode ?? 'PR',
        enabled: dto.enabled ?? true,
      },
    });
    await this.syncScheduler(schedule);
    return schedule;
  }

  async update(organizationId: string, id: string, dto: UpdateScheduleDto) {
    await this.getOr404(organizationId, id);
    const schedule = await this.prisma.schedule.update({
      where: { id },
      data: {
        name: dto.name,
        prompt: dto.prompt,
        cron: dto.cron,
        timezone: dto.timezone,
        repositoryId: dto.repositoryId,
        deliveryMode: dto.deliveryMode,
        enabled: dto.enabled,
      },
    });
    await this.syncScheduler(schedule);
    return schedule;
  }

  async remove(organizationId: string, id: string) {
    await this.getOr404(organizationId, id);
    await this.removeScheduler(id);
    await this.prisma.schedule.delete({ where: { id } });
    return { ok: true };
  }

  /** Fire a schedule right now (a "Run now" button) without waiting for cron. */
  async runNow(organizationId: string, id: string) {
    const schedule = await this.getOr404(organizationId, id);
    await this.queue.add('run', {
      scheduleId: schedule.id,
      organizationId,
    });
    return { ok: true };
  }

  private async getOr404(
    organizationId: string,
    id: string,
  ): Promise<Schedule> {
    const schedule = await this.prisma.schedule.findFirst({
      where: { id, organizationId },
    });
    if (!schedule) throw new NotFoundException(`Schedule ${id} not found`);
    return schedule;
  }

  /** Create/replace (or remove, if disabled) the BullMQ scheduler for one row. */
  private async syncScheduler(schedule: Schedule): Promise<void> {
    const id = this.schedulerId(schedule.id);
    // Always clear the old scheduler first so a cron/timezone change takes.
    await this.removeScheduler(schedule.id);
    if (!schedule.enabled) return;
    try {
      await this.queue.upsertJobScheduler(
        id,
        { pattern: schedule.cron, tz: schedule.timezone },
        {
          name: 'run',
          data: {
            scheduleId: schedule.id,
            organizationId: schedule.organizationId,
          },
        },
      );
    } catch (err) {
      this.logger.error(
        `Failed to register scheduler for ${schedule.id}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  private async removeScheduler(scheduleId: string): Promise<void> {
    try {
      await this.queue.removeJobScheduler(this.schedulerId(scheduleId));
    } catch {
      // absent scheduler → nothing to remove
    }
  }
}
