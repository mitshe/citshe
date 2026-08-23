import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';
import { CreateTaskDto, UpdateTaskDto, TaskFilterDto } from '../dto/task.dto';
import { TaskStatus, Prisma } from '@prisma/client';
import {
  PaginatedResponse,
  calculatePaginationOffset,
  createPaginatedResponse,
} from '../../../shared/pagination/pagination.dto';
import {
  TaskCreatedEvent,
  TaskStatusChangedEvent,
  TaskCompletedEvent,
  TaskFailedEvent,
} from '../../../domain/events/task.events';
import {
  QUEUES,
  TaskProcessingJob,
} from '../../../infrastructure/queue/queues';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBus,
    @InjectQueue(QUEUES.TASK_PROCESSING)
    private readonly taskQueue: Queue<TaskProcessingJob>,
  ) {}

  async create(organizationId: string, userId: string, dto: CreateTaskDto) {
    // Verify repository belongs to organization (if provided)
    if (dto.repositoryId) {
      const repository = await this.prisma.repository.findFirst({
        where: { id: dto.repositoryId, organizationId },
      });

      if (!repository) {
        throw new NotFoundException(`Repository ${dto.repositoryId} not found`);
      }
    }

    const task = await this.prisma.task.create({
      data: {
        organizationId,
        repositoryId: dto.repositoryId || null,
        title: dto.title,
        description: dto.description,
        priority: dto.priority,
        labels: dto.labels ?? [],
        deliveryMode: dto.deliveryMode ?? undefined,
        createdBy: userId,
        agentLogs: [],
      },
    });

    // Emit event
    this.eventBus.publish(
      new TaskCreatedEvent(
        task.id,
        organizationId,
        task.repositoryId,
        task.title,
        null,
      ),
    );

    return task;
  }

  async findAll(
    organizationId: string,
    filter?: TaskFilterDto,
  ): Promise<PaginatedResponse<any>> {
    const where: Prisma.TaskWhereInput = { organizationId };
    const page = filter?.page ?? 1;
    const limit = filter?.limit ?? 20;

    if (filter?.status) {
      where.status = filter.status;
    }
    if (filter?.repositoryId) {
      where.repositoryId = filter.repositoryId;
    }

    // Get total count and paginated data in parallel
    const [total, data] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: calculatePaginationOffset(page, limit),
        take: limit,
        include: {
          repository: {
            select: { id: true, name: true },
          },
        },
      }),
    ]);

    return createPaginatedResponse(data, total, page, limit);
  }

  async findOne(organizationId: string, id: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, organizationId },
      include: {
        repository: true,
      },
    });

    if (!task) {
      throw new NotFoundException(`Task ${id} not found`);
    }

    return task;
  }

  /**
   * Attach a screenshot (usually from a worker's `citshe-shot`) to a task and
   * append a `screenshot` entry to its activity feed. Bytes are stored in the
   * DB; the UI loads them from GET /tasks/:id/attachments/:attachmentId.
   */
  async attachScreenshot(
    organizationId: string,
    taskId: string,
    input: { data: Uint8Array; mimeType: string; caption?: string },
  ) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      select: { id: true, agentLogs: true },
    });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);

    const attachment = await this.prisma.taskAttachment.create({
      data: {
        taskId,
        organizationId,
        mimeType: input.mimeType,
        caption: input.caption?.slice(0, 500),
        data: new Uint8Array(input.data),
      },
      select: { id: true, caption: true, mimeType: true, createdAt: true },
    });

    // Record it in the activity feed so it shows inline under the task.
    const existing = Array.isArray(task.agentLogs) ? task.agentLogs : [];
    const logEntry = {
      agentName: 'worker',
      action: 'screenshot',
      details: { attachmentId: attachment.id, caption: input.caption ?? null },
      timestamp: new Date().toISOString(),
    };
    await this.prisma.task.update({
      where: { id: taskId },
      data: { agentLogs: [...existing, logEntry] as Prisma.JsonArray },
    });

    return attachment;
  }

  /** Stream one attachment's bytes (authorized by org ownership of its task). */
  async getAttachment(organizationId: string, attachmentId: string) {
    const attachment = await this.prisma.taskAttachment.findFirst({
      where: { id: attachmentId, organizationId },
    });
    if (!attachment) {
      throw new NotFoundException(`Attachment ${attachmentId} not found`);
    }
    return attachment;
  }

  /**
   * Add a user comment to a task's activity feed. Stored as a `comment` entry in
   * agentLogs so it renders in the same timeline as the AI's entries. The next
   * time the task is sent to AI, unaddressed comments are folded into the
   * worker prompt (see OrchestrationService).
   */
  async addComment(
    organizationId: string,
    taskId: string,
    userId: string,
    text: string,
  ) {
    const trimmed = text.trim();
    if (!trimmed) throw new BadRequestException('Comment is empty');

    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      select: { id: true, agentLogs: true },
    });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);

    // A friendly display name for the timeline.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true },
    });
    const authorName =
      [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() ||
      user?.email ||
      'You';

    const entry = {
      agentName: authorName,
      author: 'user',
      action: 'comment',
      details: { text: trimmed.slice(0, 5000) },
      timestamp: new Date().toISOString(),
    };
    const existing = Array.isArray(task.agentLogs) ? task.agentLogs : [];
    await this.prisma.task.update({
      where: { id: taskId },
      data: { agentLogs: [...existing, entry] as Prisma.JsonArray },
    });
    return entry;
  }

  /**
   * A note from the worker (Claude) added to the activity feed — the agent
   * narrating what it's doing. Rendered like the AI's other entries.
   */
  async addWorkerNote(organizationId: string, taskId: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) throw new BadRequestException('Note is empty');
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      select: { id: true, agentLogs: true },
    });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    const entry = {
      agentName: 'worker',
      action: 'note',
      details: { text: trimmed.slice(0, 5000) },
      timestamp: new Date().toISOString(),
    };
    const existing = Array.isArray(task.agentLogs) ? task.agentLogs : [];
    await this.prisma.task.update({
      where: { id: taskId },
      data: { agentLogs: [...existing, entry] as Prisma.JsonArray },
    });
    return entry;
  }

  /**
   * Let the worker set the task's status (e.g. IN_PROGRESS → REVIEW). Only a
   * safe subset is allowed so the agent can't cancel/queue itself oddly.
   */
  async setWorkerStatus(
    organizationId: string,
    taskId: string,
    status: TaskStatus,
  ) {
    const allowed: TaskStatus[] = [
      TaskStatus.IN_PROGRESS,
      TaskStatus.REVIEW,
      TaskStatus.COMPLETED,
    ];
    if (!allowed.includes(status)) {
      throw new BadRequestException(`Worker can't set status ${status}`);
    }
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      select: { id: true, status: true },
    });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status,
        closedAt: status === TaskStatus.COMPLETED ? new Date() : undefined,
      },
    });
    if (task.status !== status) {
      this.eventBus.publish(
        new TaskStatusChangedEvent(taskId, organizationId, task.status, status),
      );
    }
    return { id: updated.id, status: updated.status };
  }

  async update(organizationId: string, id: string, dto: UpdateTaskDto) {
    const task = await this.findOne(organizationId, id);
    const previousStatus = task.status;

    const updated = await this.prisma.task.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status,
        priority: dto.priority,
        labels: dto.labels,
        deliveryMode: dto.deliveryMode,
        repositoryId: dto.repositoryId,
        assigneeId: dto.assigneeId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        queueOrder: dto.queueOrder,
        result: dto.result as Prisma.InputJsonValue,
      },
    });

    // Emit status change event
    if (dto.status && dto.status !== previousStatus) {
      this.eventBus.publish(
        new TaskStatusChangedEvent(
          id,
          organizationId,
          previousStatus,
          dto.status,
        ),
      );
    }

    return updated;
  }

  async remove(organizationId: string, id: string) {
    await this.findOne(organizationId, id);
    return this.prisma.task.delete({ where: { id } });
  }

  /** Close a task: mark it COMPLETED and stamp closedAt. */
  async close(organizationId: string, id: string) {
    const task = await this.findOne(organizationId, id);
    const previousStatus = task.status;

    const updated = await this.prisma.task.update({
      where: { id },
      data: { status: TaskStatus.COMPLETED, closedAt: new Date() },
    });

    if (previousStatus !== TaskStatus.COMPLETED) {
      this.eventBus.publish(
        new TaskStatusChangedEvent(
          id,
          organizationId,
          previousStatus,
          TaskStatus.COMPLETED,
        ),
      );
    }

    return updated;
  }

  /** Reopen a task: move it back to PENDING and clear closedAt. */
  async reopen(organizationId: string, id: string) {
    const task = await this.findOne(organizationId, id);
    const previousStatus = task.status;

    const updated = await this.prisma.task.update({
      where: { id },
      data: { status: TaskStatus.PENDING, closedAt: null },
    });

    if (previousStatus !== TaskStatus.PENDING) {
      this.eventBus.publish(
        new TaskStatusChangedEvent(
          id,
          organizationId,
          previousStatus,
          TaskStatus.PENDING,
        ),
      );
    }

    return updated;
  }

  // =========================================================================
  // Task Processing Methods
  // =========================================================================

  async startProcessing(organizationId: string, id: string) {
    let previousStatus: TaskStatus = TaskStatus.PENDING;
    // Use transaction to prevent race condition between status check and update
    const updated = await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.findFirst({
        where: { id, organizationId },
        include: { repository: true },
      });

      if (!task) {
        throw new NotFoundException(`Task ${id} not found`);
      }

      // A task can be sent to AI while it's waiting to run (PENDING or QUEUED).
      // A task that's already ANALYZING/IN_PROGRESS is in flight; a
      // REVIEW/closed one uses Reopen first — those still reject.
      const startable: TaskStatus[] = [TaskStatus.PENDING, TaskStatus.QUEUED];
      if (!startable.includes(task.status)) {
        throw new BadRequestException(
          `Task ${id} can't be processed in status ${task.status}`,
        );
      }
      previousStatus = task.status;

      return tx.task.update({
        where: { id },
        data: { status: TaskStatus.ANALYZING },
      });
    });

    // Emit status change event
    this.eventBus.publish(
      new TaskStatusChangedEvent(
        id,
        organizationId,
        previousStatus,
        TaskStatus.ANALYZING,
      ),
    );

    // Enqueue task for AI processing
    await this.taskQueue.add(
      'analyze',
      {
        type: 'analyze',
        taskId: id,
        organizationId,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );

    this.logger.log(`Task ${id} enqueued for AI processing`);

    return updated;
  }

  async cancel(organizationId: string, id: string) {
    const cancellableStatuses: TaskStatus[] = [
      TaskStatus.PENDING,
      TaskStatus.ANALYZING,
      TaskStatus.IN_PROGRESS,
    ];

    // Use transaction to prevent race condition between status check and update
    const { updated, previousStatus } = await this.prisma.$transaction(
      async (tx) => {
        const task = await tx.task.findFirst({
          where: { id, organizationId },
        });

        if (!task) {
          throw new NotFoundException(`Task ${id} not found`);
        }

        if (!cancellableStatuses.includes(task.status)) {
          throw new BadRequestException(
            `Task ${id} cannot be cancelled in status ${task.status}`,
          );
        }

        const result = await tx.task.update({
          where: { id },
          data: { status: TaskStatus.CANCELLED },
        });

        return { updated: result, previousStatus: task.status };
      },
    );

    this.eventBus.publish(
      new TaskStatusChangedEvent(
        id,
        organizationId,
        previousStatus,
        TaskStatus.CANCELLED,
      ),
    );

    return updated;
  }

  async complete(
    organizationId: string,
    id: string,
    result: Record<string, unknown>,
  ) {
    // Use transaction to ensure atomic read-check-update
    const updated = await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.findFirst({
        where: { id, organizationId },
      });

      if (!task) {
        throw new NotFoundException(`Task ${id} not found`);
      }

      return tx.task.update({
        where: { id },
        data: {
          status: TaskStatus.COMPLETED,
          result: result as Prisma.InputJsonValue,
        },
      });
    });

    this.eventBus.publish(
      new TaskCompletedEvent(id, organizationId, result as any),
    );

    return updated;
  }

  async fail(organizationId: string, id: string, reason: string) {
    // Use transaction to ensure atomic read-check-update
    const updated = await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.findFirst({
        where: { id, organizationId },
      });

      if (!task) {
        throw new NotFoundException(`Task ${id} not found`);
      }

      return tx.task.update({
        where: { id },
        data: {
          status: TaskStatus.FAILED,
          result: {
            type: 'manual_intervention',
            reason,
          } as Prisma.InputJsonValue,
        },
      });
    });

    this.eventBus.publish(new TaskFailedEvent(id, organizationId, reason));

    return updated;
  }

  async addAgentLog(
    organizationId: string,
    id: string,
    log: {
      agentName: string;
      action: string;
      details?: Record<string, unknown>;
    },
  ) {
    // Use transaction to prevent lost writes when concurrent requests append logs
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.findFirst({
        where: { id, organizationId },
      });

      if (!task) {
        throw new NotFoundException(`Task ${id} not found`);
      }

      const currentLogs = (task.agentLogs as any[]) || [];

      return tx.task.update({
        where: { id },
        data: {
          agentLogs: [
            ...currentLogs,
            { ...log, timestamp: new Date().toISOString() },
          ] as Prisma.InputJsonValue,
        },
      });
    });
  }
}
