import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { TasksService } from '../services/tasks.service';
import { TaskComposerService } from '../services/task-composer.service';
import { OrchestrationService } from '../../mcp/orchestration/orchestration.service';
import {
  CreateTaskDto,
  UpdateTaskDto,
  TaskFilterDto,
  TaskWrapperResponseDto,
  TaskWithMessageResponseDto,
  TaskListResponseDto,
} from '../dto/task.dto';
import { AuthGuard } from '@/shared/auth';
import {
  OrganizationId,
  UserId,
} from '../../../shared/decorators/organization.decorator';
import { ApiRateLimit } from '../../../shared/decorators/throttle.decorator';

@ApiTags('Tasks')
@ApiBearerAuth('bearer')
@Controller('api/v1/tasks')
@UseGuards(AuthGuard)
@ApiRateLimit()
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly composer: TaskComposerService,
    private readonly orchestration: OrchestrationService,
  ) {}

  @Post('refine')
  @ApiOperation({
    summary: 'AI-refine a rough task draft (title/description/labels/subtasks)',
  })
  @ApiResponse({ status: 200, description: 'Refined task suggestion' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @HttpCode(HttpStatus.OK)
  async refine(
    @OrganizationId() organizationId: string,
    @Body() body: { title: string; description?: string },
  ) {
    return this.composer.refine(organizationId, {
      title: body?.title ?? '',
      description: body?.description,
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create a new task' })
  @ApiResponse({
    status: 201,
    description: 'Task created successfully',
    type: TaskWrapperResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @OrganizationId() organizationId: string,
    @UserId() userId: string,
    @Body() dto: CreateTaskDto,
  ) {
    const task = await this.tasksService.create(organizationId, userId, dto);
    return { task };
  }

  @Get()
  @ApiOperation({
    summary: 'Get all tasks with optional filtering and pagination',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated list of tasks',
    type: TaskListResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiQuery({
    name: 'repositoryId',
    required: false,
    description: 'Filter by repository ID',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Filter by status',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Items per page (default: 20, max: 100)',
  })
  async findAll(
    @OrganizationId() organizationId: string,
    @Query() filter: TaskFilterDto,
  ) {
    return this.tasksService.findAll(organizationId, filter);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a task by ID' })
  @ApiResponse({
    status: 200,
    description: 'Returns the task',
    type: TaskWrapperResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findOne(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    const task = await this.tasksService.findOne(organizationId, id);
    return { task };
  }

  @Get(':id/attachments/:attachmentId')
  @ApiOperation({ summary: 'Stream a task attachment (e.g. a screenshot)' })
  @ApiResponse({ status: 200, description: 'The attachment bytes' })
  @ApiResponse({ status: 404, description: 'Attachment not found' })
  async getAttachment(
    @OrganizationId() organizationId: string,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ) {
    const attachment = await this.tasksService.getAttachment(
      organizationId,
      attachmentId,
    );
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from(attachment.data));
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a task' })
  @ApiResponse({
    status: 200,
    description: 'Task updated successfully',
    type: TaskWrapperResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async update(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    const task = await this.tasksService.update(organizationId, id, dto);
    // If the caller repositioned the task in the Queue, also re-prioritize its
    // pending BullMQ job so the worker pull order follows the new position.
    if (dto.queueOrder !== undefined) {
      await this.orchestration.reorderTask(organizationId, id, dto.queueOrder);
    }
    return { task };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a task' })
  @ApiResponse({ status: 204, description: 'Task deleted successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async remove(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    await this.tasksService.remove(organizationId, id);
  }

  // =========================================================================
  // Task Processing Endpoints
  // =========================================================================

  @Post(':id/process')
  @ApiOperation({ summary: 'Start AI processing for a task' })
  @ApiResponse({
    status: 200,
    description: 'Task processing started',
    type: TaskWithMessageResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async startProcessing(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    const task = await this.tasksService.startProcessing(organizationId, id);
    return { task, message: 'Task processing started' };
  }

  @Post(':id/queue')
  @ApiOperation({
    summary:
      'Move a task into the Queue column (status QUEUED, appended to the end)',
  })
  @ApiResponse({
    status: 200,
    description: 'Task queued',
    type: TaskWrapperResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @HttpCode(HttpStatus.OK)
  async enqueue(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    const task = await this.orchestration.enqueueTask(organizationId, id);
    return { task };
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a task' })
  @ApiResponse({
    status: 200,
    description: 'Task cancelled',
    type: TaskWithMessageResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async cancel(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    const task = await this.tasksService.cancel(organizationId, id);
    return { task, message: 'Task cancelled' };
  }

  @Post(':id/close')
  @ApiOperation({ summary: 'Close a task (mark completed)' })
  @ApiResponse({
    status: 200,
    description: 'Task closed',
    type: TaskWithMessageResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @HttpCode(HttpStatus.OK)
  async close(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    const task = await this.tasksService.close(organizationId, id);
    return { task, message: 'Task closed' };
  }

  @Post(':id/reopen')
  @ApiOperation({ summary: 'Reopen a closed task' })
  @ApiResponse({
    status: 200,
    description: 'Task reopened',
    type: TaskWithMessageResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @HttpCode(HttpStatus.OK)
  async reopen(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    const task = await this.tasksService.reopen(organizationId, id);
    return { task, message: 'Task reopened' };
  }
}
