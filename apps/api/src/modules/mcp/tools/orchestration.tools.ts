import { Injectable } from '@nestjs/common';
import { McpTool, McpToolResult } from '../mcp.types';
import { OrchestrationService } from '../orchestration/orchestration.service';

/**
 * MCP tools that turn the main chat into an orchestrator: it inspects the
 * queue, dispatches tasks to worker threads, and pauses/resumes the queue.
 * The orchestrator plans and delegates here; it does not implement.
 */
@Injectable()
export class OrchestrationTools {
  constructor(private readonly orchestration: OrchestrationService) {}

  getTools(): McpTool[] {
    return [
      {
        name: 'queue_status',
        description:
          'Show the task queue and workers: which tasks are pending/queued/' +
          'in-progress/review, how many worker threads are running, and whether ' +
          'the queue is paused. Use this to plan what to dispatch next.',
        inputSchema: { type: 'object', properties: {} },
        execute: async (organizationId): Promise<McpToolResult> => {
          const overview =
            await this.orchestration.getQueueOverview(organizationId);
          return { content: JSON.stringify(overview) };
        },
      },
      {
        name: 'task_dispatch',
        description:
          'Send a task to a worker thread that will complete it end-to-end ' +
          '(write code, run tests, commit, open a PR). If the queue is paused ' +
          'or at worker capacity, the task is queued and runs automatically ' +
          'later. Returns immediately — track progress via queue_status or the ' +
          "task's live updates.",
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'ID of the task to run.' },
            repositoryIds: {
              type: 'string',
              description:
                'Optional comma-separated repository IDs the worker should ' +
                'work in. Defaults to the org’s single active repo if there is one.',
            },
          },
          required: ['taskId'],
        },
        execute: async (
          organizationId,
          userId,
          input,
        ): Promise<McpToolResult> => {
          const repositoryIds = (input.repositoryIds as string | undefined)
            ?.split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          const result = await this.orchestration.dispatchTask(
            organizationId,
            userId,
            input.taskId as string,
            repositoryIds && repositoryIds.length ? { repositoryIds } : undefined,
          );
          return {
            content: JSON.stringify(result),
            isError: result.status === 'error',
          };
        },
      },
      {
        name: 'queue_pause',
        description:
          'Pause the queue. Dispatched tasks stay QUEUED and no new worker ' +
          'threads start until you resume. Use when you want to review before ' +
          'work runs.',
        inputSchema: { type: 'object', properties: {} },
        execute: async (organizationId): Promise<McpToolResult> => {
          const result = await this.orchestration.setQueuePaused(
            organizationId,
            true,
          );
          return { content: JSON.stringify(result) };
        },
      },
      {
        name: 'queue_resume',
        description:
          'Resume the queue and immediately dispatch queued tasks up to the ' +
          'worker limit.',
        inputSchema: { type: 'object', properties: {} },
        execute: async (organizationId, userId): Promise<McpToolResult> => {
          await this.orchestration.setQueuePaused(organizationId, false);
          const drained = await this.orchestration.drainQueue(
            organizationId,
            userId,
          );
          return {
            content: JSON.stringify({ queuePaused: false, ...drained }),
          };
        },
      },
    ];
  }
}
