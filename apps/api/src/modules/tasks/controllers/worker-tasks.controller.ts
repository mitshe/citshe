import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { TaskStatus } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { TasksService } from '../services/tasks.service';
import { SchedulesService } from '../../schedules/services/schedules.service';

interface WorkerTokenPayload {
  organizationId: string;
  userId: string;
  taskId?: string;
  type: string;
}

/**
 * Lets a worker container create follow-up tasks on the board. It is NOT behind
 * the normal user AuthGuard — instead it accepts a short-lived worker token
 * (signed with JWT_SECRET, carrying the org + user the worker runs as) that is
 * injected into the container as CITSHE_WORKER_TOKEN. This is how Claude, while
 * running a task, can add more tasks to the queue.
 */
@ApiTags('worker')
@Controller('api/v1/worker/tasks')
export class WorkerTasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly schedulesService: SchedulesService,
    private readonly config: ConfigService,
  ) {}

  /** Verify + decode a worker token, or throw 401. */
  private verifyWorker(authorization: string | undefined): WorkerTokenPayload {
    const token = authorization?.replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new UnauthorizedException('Missing worker token');

    let payload: WorkerTokenPayload;
    try {
      payload = jwt.verify(
        token,
        this.config.get<string>('JWT_SECRET') || 'dev-secret',
      ) as WorkerTokenPayload;
    } catch {
      throw new UnauthorizedException('Invalid worker token');
    }
    if (payload.type !== 'worker') {
      throw new UnauthorizedException('Not a worker token');
    }
    return payload;
  }

  @Post()
  @ApiOperation({ summary: 'Create a task from inside a worker container' })
  async create(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { title?: string; description?: string; labels?: string[] },
  ) {
    const payload = this.verifyWorker(authorization);

    const title = (body.title || '').trim();
    if (!title) throw new BadRequestException('title is required');

    const task = await this.tasksService.create(
      payload.organizationId,
      payload.userId,
      {
        title: title.slice(0, 200),
        description: body.description?.slice(0, 10_000),
        labels: Array.isArray(body.labels)
          ? body.labels.slice(0, 20)
          : undefined,
      },
    );
    return { id: task.id, title: task.title };
  }

  @Post(':taskId/screenshot')
  @ApiOperation({
    summary: 'Attach a screenshot (base64 PNG) to the task from a worker',
  })
  async screenshot(
    @Headers('authorization') authorization: string | undefined,
    @Param('taskId') taskId: string,
    @Body() body: { image?: string; caption?: string; mimeType?: string },
  ) {
    const payload = this.verifyWorker(authorization);

    // The token pins the task it may attach to; the path must match it.
    if (payload.taskId && payload.taskId !== taskId) {
      throw new UnauthorizedException('Token is not for this task');
    }

    const b64 = (body.image || '').replace(/^data:[^,]+,/, '').trim();
    if (!b64) throw new BadRequestException('image (base64) is required');

    const data = Buffer.from(b64, 'base64');
    // Guard against absurd payloads (≈8MB of raw image).
    if (data.length === 0 || data.length > 8 * 1024 * 1024) {
      throw new BadRequestException('image is empty or too large (max 8MB)');
    }

    const attachment = await this.tasksService.attachScreenshot(
      payload.organizationId,
      taskId,
      {
        data,
        mimeType: body.mimeType || 'image/png',
        caption: body.caption,
      },
    );
    return { id: attachment.id };
  }

  @Post(':taskId/note')
  @ApiOperation({ summary: 'Add a worker note to the task activity' })
  async note(
    @Headers('authorization') authorization: string | undefined,
    @Param('taskId') taskId: string,
    @Body() body: { text?: string },
  ) {
    const payload = this.verifyWorker(authorization);
    if (payload.taskId && payload.taskId !== taskId) {
      throw new UnauthorizedException('Token is not for this task');
    }
    await this.tasksService.addWorkerNote(
      payload.organizationId,
      taskId,
      body.text ?? '',
    );
    return { ok: true };
  }

  @Post(':taskId/status')
  @ApiOperation({ summary: 'Set the task status from the worker' })
  async status(
    @Headers('authorization') authorization: string | undefined,
    @Param('taskId') taskId: string,
    @Body() body: { status?: string },
  ) {
    const payload = this.verifyWorker(authorization);
    if (payload.taskId && payload.taskId !== taskId) {
      throw new UnauthorizedException('Token is not for this task');
    }
    const raw = (body.status || '').toUpperCase().replace(/[\s-]+/g, '_');
    const map: Record<string, TaskStatus> = {
      IN_PROGRESS: TaskStatus.IN_PROGRESS,
      INPROGRESS: TaskStatus.IN_PROGRESS,
      REVIEW: TaskStatus.REVIEW,
      DONE: TaskStatus.COMPLETED,
      COMPLETED: TaskStatus.COMPLETED,
    };
    const status = map[raw];
    if (!status)
      throw new BadRequestException(`Unknown status "${body.status}"`);
    return this.tasksService.setWorkerStatus(
      payload.organizationId,
      taskId,
      status,
    );
  }

  @Post(':taskId/site')
  @ApiOperation({ summary: 'Report the live URL of a deployed build task' })
  async site(
    @Headers('authorization') authorization: string | undefined,
    @Param('taskId') taskId: string,
    @Body() body: { url?: string },
  ) {
    const payload = this.verifyWorker(authorization);
    if (payload.taskId && payload.taskId !== taskId) {
      throw new UnauthorizedException('Token is not for this task');
    }
    const url = (body.url || '').trim();
    if (!/^https?:\/\/\S+$/i.test(url)) {
      throw new BadRequestException('url must be a valid http(s) URL');
    }
    await this.tasksService.setWorkerSiteUrl(
      payload.organizationId,
      taskId,
      url,
    );
    return { ok: true };
  }

  @Post('schedule')
  @ApiOperation({
    summary: 'Arm a citshe-side recurring task (cron) from inside a worker',
  })
  async schedule(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { name?: string; prompt?: string; cron?: string },
  ) {
    const payload = this.verifyWorker(authorization);

    const name = (body.name || '').trim();
    const prompt = (body.prompt || '').trim();
    const cron = (body.cron || '').trim();
    if (!name) throw new BadRequestException('name is required');
    if (!prompt) throw new BadRequestException('prompt is required');
    // A 5-field cron expression (minute hour dom month dow).
    if (!/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(cron)) {
      throw new BadRequestException(
        'cron must be a 5-field expression, e.g. "0 * * * *"',
      );
    }

    const schedule = await this.schedulesService.create(
      payload.organizationId,
      payload.userId,
      {
        name: name.slice(0, 200),
        prompt: prompt.slice(0, 10_000),
        cron,
      },
    );
    return { id: schedule.id, name: schedule.name, cron: schedule.cron };
  }
}
