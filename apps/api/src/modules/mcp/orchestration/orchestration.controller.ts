import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { OrchestrationService } from './orchestration.service';
import { AuthGuard } from '@/shared/auth';
import { OrganizationId } from '../../../shared/decorators/organization.decorator';

/**
 * HTTP surface for the orchestrator queue, so the web panel can show the live
 * queue state (workers running / limit / paused) and toggle the pause switch.
 * The orchestrator itself drives the queue via MCP tools; this is read/control
 * for humans watching from the browser.
 */
@ApiTags('Orchestration')
@ApiBearerAuth('bearer')
@Controller('api/v1/orchestration')
@UseGuards(AuthGuard)
export class OrchestrationController {
  constructor(private readonly orchestration: OrchestrationService) {}

  @Get('queue')
  @ApiOperation({ summary: 'Snapshot of the task queue and running workers' })
  @ApiResponse({ status: 200, description: 'Queue overview' })
  async queue(@OrganizationId() organizationId: string) {
    return this.orchestration.getQueueOverview(organizationId);
  }

  @Post('queue/pause')
  @ApiOperation({ summary: 'Pause or resume automatic worker dispatch' })
  @ApiResponse({ status: 200, description: 'New pause state' })
  async setPaused(
    @OrganizationId() organizationId: string,
    @Body() body: { paused: boolean },
  ) {
    return this.orchestration.setQueuePaused(organizationId, !!body.paused);
  }

  @Post('queue/auto-pull')
  @ApiOperation({
    summary:
      'Toggle per-portal auto-pull: ON enqueues QUEUED tasks to workers, OFF holds them',
  })
  @ApiResponse({ status: 200, description: 'New auto-pull state' })
  async setAutoPull(
    @OrganizationId() organizationId: string,
    @Body() body: { autoPull: boolean },
  ) {
    return this.orchestration.setAutoPull(organizationId, !!body.autoPull);
  }

  @Post('queue/reorder')
  @ApiOperation({
    summary: 'Reorder a task within the Queue column (set its queueOrder)',
  })
  @ApiResponse({ status: 200, description: 'Updated task' })
  async reorder(
    @OrganizationId() organizationId: string,
    @Body() body: { taskId: string; queueOrder: number },
  ) {
    return this.orchestration.reorderTask(
      organizationId,
      body.taskId,
      body.queueOrder,
    );
  }
}
