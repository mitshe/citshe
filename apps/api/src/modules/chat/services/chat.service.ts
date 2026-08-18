import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';
import { AdapterFactoryService } from '../../../infrastructure/adapters/adapter-factory.service';
import { McpService } from '../../mcp/mcp.service';
import {
  Message,
  ToolResultContent,
  ToolUseContent,
} from '../../../ports/ai-provider.port';
import {
  CreateConversationDto,
  SendMessageDto,
  UpdateConversationDto,
} from '../dto/chat.dto';

const SYSTEM_PROMPT = `You are the citshe orchestrator — the persistent lead engineer the user talks to.

Your job is to PLAN and DELEGATE, not to implement. You break the user's goals
into concrete tasks and dispatch them to worker threads (isolated Docker
containers running Claude Code) that do the actual coding, testing, committing,
and open the pull requests. You keep the big picture across the whole
conversation; workers do one task and report back.

We call isolated worker workspaces "threads". Internally the API says "session"
but always say "thread" to the user.

CRITICAL RULES:
1. ALWAYS use tools to perform actions. NEVER claim you did something without calling the tool.
2. Only describe results AFTER you receive the tool response. Never fabricate IDs or statuses.
3. If a tool call fails, tell the user what went wrong honestly.
4. After completing tool calls, ALWAYS end with a short text summary. Never end with only tool calls.
5. You do NOT write code yourself in this chat. To get code written, create a task and dispatch it to a worker.

HOW YOU WORK (the loop):
1. Discuss the goal with the user and decompose it into small, independent tasks.
2. For each task, call task_create (title + a clear, self-contained description).
3. Dispatch it with task_dispatch — a worker thread spins up, does the whole task
   (code → tests → commit → PR), and reports back. Dispatch is async: it returns
   immediately; progress streams to the user live.
4. Use queue_status to see what's pending/queued/in-progress and how many workers
   are running. Dispatch more as capacity frees up (limit is a few workers at once).
5. When workers finish (status REVIEW), summarize what was done for the user.

Orchestration tools:
- queue_status — see the task queue + running workers + whether the queue is paused.
- task_create / task_update / task_list / task_get — manage the task queue.
- task_dispatch — send a task to a worker thread (the main way you get work done).
- queue_pause / queue_resume — hold or release automatic dispatch.

Direct thread tools (for hands-on work or debugging, not routine task execution):
- session_create — open a thread yourself (terminal, git, browser).
- session_agent — send a prompt to Claude Code inside a running thread.
- session_exec — run a shell command in a thread.
- session_list / session_get / session_stop — manage threads.

Setup & data tools:
- repository_list / repository_sync — list and sync GitHub repositories.
- skill_* — create/list/update/delete reusable Claude Code instructions (skills).

Concepts:
- THREAD/WORKER = isolated Docker container with Claude Code, terminal, and git. Always starts fresh.
- TASK = a unit of work in the queue. Dispatching a task runs it in a worker thread.
- SKILL = reusable instructions available to workers as Claude Code slash commands.
- Each org connects ONE git provider: GitHub (repositories are the unit of work).

Onboarding a user with nothing set up yet:
1. Make sure GitHub is connected and repos are synced (repository_sync).
2. Talk through the goal, create tasks, and dispatch them.

Be concise and act. NEVER tell the user to go to a settings page — do it with tools when you can.`;

const MAX_TOOL_ITERATIONS = 15;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactoryService,
    private readonly mcpService: McpService,
  ) {}

  async createConversation(
    organizationId: string,
    userId: string,
    dto: CreateConversationDto,
  ) {
    return this.prisma.chatConversation.create({
      data: {
        organizationId,
        userId,
        title: dto.title,
        aiCredentialId: dto.aiCredentialId,
        model: dto.model,
      },
    });
  }

  async findAllConversations(
    organizationId: string,
    userId: string,
    limit = 8,
  ) {
    return this.prisma.chatConversation.findMany({
      where: { organizationId, userId },
      include: {
        _count: { select: { messages: true } },
        aiCredential: { select: { id: true, provider: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  }

  async findConversation(organizationId: string, userId: string, id: string) {
    const conversation = await this.prisma.chatConversation.findFirst({
      where: { id, organizationId, userId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        aiCredential: { select: { id: true, provider: true } },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return conversation;
  }

  async updateConversation(
    organizationId: string,
    userId: string,
    id: string,
    dto: UpdateConversationDto,
  ) {
    const conversation = await this.findConversation(
      organizationId,
      userId,
      id,
    );

    return this.prisma.chatConversation.update({
      where: { id: conversation.id },
      data: { title: dto.title },
    });
  }

  async deleteConversation(organizationId: string, userId: string, id: string) {
    const conversation = await this.findConversation(
      organizationId,
      userId,
      id,
    );
    return this.prisma.chatConversation.delete({
      where: { id: conversation.id },
    });
  }

  async sendMessage(
    organizationId: string,
    userId: string,
    conversationId: string,
    dto: SendMessageDto,
  ): Promise<{
    userMessage: any;
    assistantMessage: any;
    toolCalls: Array<{ name: string; input: any; result: any }>;
  }> {
    const conversation = await this.findConversation(
      organizationId,
      userId,
      conversationId,
    );

    // Resolve AI provider
    const credentialId = dto.aiCredentialId || conversation.aiCredentialId;
    let aiProvider;
    try {
      if (credentialId) {
        aiProvider = await this.adapterFactory.createAIProviderFromCredential(
          organizationId,
          credentialId,
        );
      } else {
        aiProvider =
          await this.adapterFactory.getDefaultAIProvider(organizationId);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to load AI provider: ${msg}`);
      throw new BadRequestException(
        `Failed to load AI provider. The API key may be corrupted or the ENCRYPTION_KEY changed. Please re-add your AI credential in Settings → AI Providers. (${msg})`,
      );
    }

    if (!aiProvider) {
      throw new BadRequestException(
        'No AI provider configured. Add an AI credential in Settings → AI Providers.',
      );
    }

    // Save user message
    const userMessage = await this.prisma.chatMessage.create({
      data: {
        conversationId,
        role: 'user',
        content: dto.content,
      },
    });

    // Build message history from DB
    const messages = this.buildMessages(conversation.messages, dto.content);

    // Get MCP tools as AI tool definitions
    const tools = this.mcpService.getToolDefinitions();

    // Tool use loop
    const allToolCalls: Array<{
      name: string;
      input: any;
      result: any;
    }> = [];
    let currentMessages = messages;
    let finalContent = '';
    let iterations = 0;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      const response = await aiProvider.completeWithTools(
        currentMessages,
        tools,
        {
          systemPrompt: SYSTEM_PROMPT,
          model: dto.model || conversation.model || undefined,
          maxTokens: 4096,
        },
      );

      // Collect text content
      finalContent = response.content;

      // If no tool calls, we're done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        break;
      }

      // Execute tool calls
      const toolResults: ToolResultContent[] = [];
      const toolUseBlocks: ToolUseContent[] = [];

      for (const toolCall of response.toolCalls) {
        const result = await this.mcpService.executeTool(
          toolCall.name,
          organizationId,
          userId,
          toolCall.input,
        );

        allToolCalls.push({
          name: toolCall.name,
          input: toolCall.input,
          result: (() => {
            try {
              return JSON.parse(result.content);
            } catch {
              return { message: result.content };
            }
          })(),
        });

        toolUseBlocks.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: result.content,
          is_error: result.isError,
        });
      }

      // Append assistant message with tool use + tool results for next iteration
      currentMessages = [
        ...currentMessages,
        {
          role: 'assistant' as const,
          content: [
            ...(response.content
              ? [{ type: 'text' as const, text: response.content }]
              : []),
            ...toolUseBlocks,
          ],
        },
        {
          role: 'user' as const,
          content: toolResults,
        },
      ];

      // If stop reason is not tool_use, we're done
      if (response.stopReason !== 'tool_use') {
        break;
      }

      // If all tool calls errored, break to avoid infinite loop
      const allErrored = toolResults.every((r) => r.is_error);
      if (allErrored) {
        this.logger.warn(
          `All ${toolResults.length} tool calls returned errors — breaking loop`,
        );
        break;
      }
    }

    if (iterations >= MAX_TOOL_ITERATIONS) {
      this.logger.warn(
        `Chat reached MAX_TOOL_ITERATIONS (${MAX_TOOL_ITERATIONS})`,
      );
    }

    // Save assistant message with tool calls
    const assistantMessage = await this.prisma.chatMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        content: finalContent,
        toolUse: allToolCalls.length > 0 ? (allToolCalls as any) : undefined,
      },
    });

    // Auto-generate title from first message if not set
    if (!conversation.title && dto.content.length > 0) {
      const title = dto.content.slice(0, 100);
      await this.prisma.chatConversation.update({
        where: { id: conversationId },
        data: { title },
      });
    }

    return { userMessage, assistantMessage, toolCalls: allToolCalls };
  }

  private buildMessages(
    existingMessages: Array<{ role: string; content: string; toolUse: any }>,
    newUserContent: string,
  ): Message[] {
    const messages: Message[] = [];

    for (const msg of existingMessages) {
      messages.push({
        role: msg.role as any,
        content: msg.content,
      });
    }

    messages.push({
      role: 'user',
      content: newUserContent,
    });

    return messages;
  }
}
