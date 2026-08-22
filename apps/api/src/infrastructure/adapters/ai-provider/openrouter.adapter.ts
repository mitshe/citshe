import { Logger } from '@nestjs/common';
import {
  AIProviderPort,
  Message,
  AIResponse,
  AIResponseWithTools,
  CompletionOptions,
  ToolDefinition,
  StreamEvent,
} from '../../../ports/ai-provider.port';

/**
 * OpenRouter adapter — OpenAI-compatible chat completions over
 * https://openrouter.ai/api/v1. Used for the panel's small tasks (Improve-with-AI,
 * summaries), NOT the worker engine (that's Claude Code CLI via subscription).
 * One key → 100+ models.
 */
export class OpenRouterAdapter implements AIProviderPort {
  private readonly logger = new Logger(OpenRouterAdapter.name);
  private readonly baseUrl = 'https://openrouter.ai/api/v1';
  private readonly apiKey: string;
  private readonly defaultModel: string;

  constructor(config: { apiKey: string; defaultModel?: string }) {
    this.apiKey = config.apiKey;
    this.defaultModel = config.defaultModel || 'anthropic/claude-3.7-sonnet';
  }

  getProviderType(): 'openai' {
    // OpenAI-compatible wire format; the port union has no 'openrouter'.
    return 'openai';
  }

  getProviderName(): string {
    return 'OpenRouter';
  }

  async isAvailable(): Promise<boolean> {
    return (await this.testConnection()).success;
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await this.complete([{ role: 'user', content: 'Hi' }], {
        maxTokens: 5,
      });
      return { success: !!res.content };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`OpenRouter test failed: ${message}`);
      return { success: false, error: message };
    }
  }

  listModels(): Promise<string[]> {
    return Promise.resolve([
      'anthropic/claude-3.7-sonnet',
      'anthropic/claude-3.5-haiku',
      'openai/gpt-4o-mini',
      'google/gemini-flash-1.5',
      'meta-llama/llama-3.1-70b-instruct',
    ]);
  }

  async complete(
    messages: Message[],
    options?: CompletionOptions,
  ): Promise<AIResponse> {
    const body: Record<string, unknown> = {
      model: options?.model || this.defaultModel,
      max_tokens: options?.maxTokens || 1024,
      temperature: options?.temperature,
      top_p: options?.topP,
      messages: this.formatMessages(messages, options?.systemPrompt),
      stop: options?.stopSequences,
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        // OpenRouter attribution headers (optional but recommended).
        'HTTP-Referer': 'https://citshe.local',
        'X-Title': 'citshe',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    const choice = json.choices?.[0];
    return {
      content: choice?.message?.content ?? '',
      model: json.model || this.defaultModel,
      tokensUsed: {
        input: json.usage?.prompt_tokens || 0,
        output: json.usage?.completion_tokens || 0,
      },
      finishReason:
        choice?.finish_reason === 'length' ? 'length' : 'stop',
    };
  }

  /**
   * Fetch the OpenRouter credit balance. Resilient: returns null on any
   * non-ok response or parse failure, never throws.
   */
  async getCredits(): Promise<{
    totalCredits: number;
    totalUsage: number;
    remaining: number;
  } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/credits`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!res.ok) {
        this.logger.warn(`OpenRouter credits fetch failed: ${res.status}`);
        return null;
      }

      const json = await res.json();
      const totalCredits = Number(json?.data?.total_credits);
      const totalUsage = Number(json?.data?.total_usage);

      if (!Number.isFinite(totalCredits) || !Number.isFinite(totalUsage)) {
        return null;
      }

      return {
        totalCredits,
        totalUsage,
        remaining: totalCredits - totalUsage,
      };
    } catch (err) {
      this.logger.warn(
        `OpenRouter credits fetch error: ${(err as Error).message}`,
      );
      return null;
    }
  }

  completeWithTools(
    _messages: Message[],
    _tools: ToolDefinition[],
    _options?: CompletionOptions,
  ): Promise<AIResponseWithTools> {
    // The panel only needs plain completions; tools are the worker's job.
    throw new Error('Tool use is not supported by the OpenRouter panel adapter.');
  }

  // eslint-disable-next-line require-yield
  async *streamComplete(): AsyncGenerator<StreamEvent, void, unknown> {
    throw new Error('Streaming is not supported by the OpenRouter panel adapter.');
  }

  /** OpenAI-style messages; fold systemPrompt into a leading system message. */
  private formatMessages(messages: Message[], systemPrompt?: string) {
    const out: Array<{ role: string; content: string }> = [];
    if (systemPrompt) out.push({ role: 'system', content: systemPrompt });
    for (const m of messages) {
      out.push({
        role: m.role,
        content:
          typeof m.content === 'string'
            ? m.content
            : m.content
                .map((c) => ('text' in c ? c.text : ''))
                .join(''),
      });
    }
    return out;
  }
}

export function createOpenRouterAdapter(config: {
  apiKey: string;
  defaultModel?: string;
}): AIProviderPort {
  return new OpenRouterAdapter(config);
}
