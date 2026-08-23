import {
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { TasksService } from '../services/tasks.service';

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
    private readonly config: ConfigService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a task from inside a worker container' })
  async create(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { title?: string; description?: string; labels?: string[] },
  ) {
    const token = authorization?.replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new UnauthorizedException('Missing worker token');

    let payload: { organizationId: string; userId: string; type: string };
    try {
      payload = jwt.verify(
        token,
        this.config.get<string>('JWT_SECRET') || 'dev-secret',
      ) as typeof payload;
    } catch {
      throw new UnauthorizedException('Invalid worker token');
    }
    if (payload.type !== 'worker') {
      throw new UnauthorizedException('Not a worker token');
    }

    const title = (body.title || '').trim();
    if (!title) throw new UnauthorizedException('title is required');

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
}
