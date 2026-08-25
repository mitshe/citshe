import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AdapterFactoryService } from '../../../infrastructure/adapters/adapter-factory.service';

export interface RefinedTask {
  title: string;
  description: string;
  labels: string[];
  subtasks: { title: string; description: string; labels: string[] }[];
}

/**
 * AI help while writing a task — the replacement for a standalone chat.
 * You type a rough draft; Claude tightens the title/description, proposes
 * labels, and (when the work is big) suggests a breakdown into subtasks.
 * It never creates anything — it only returns a suggestion the human accepts.
 */
@Injectable()
export class TaskComposerService {
  private readonly logger = new Logger(TaskComposerService.name);

  constructor(private readonly adapterFactory: AdapterFactoryService) {}

  private readonly SYSTEM_PROMPT = `You help a developer turn a rough note into a well-formed engineering task for an AI coding agent (a worker that clones a repo, writes code, and opens a PR).

Given the draft, return a tightened version:
- title: one imperative line, concrete and specific (max 100 chars).
- description: 1-4 sentences of what to do and the acceptance criteria. Keep the user's intent; add clarity, not scope. If the draft is already clear, keep it.
- labels: 1-5 short lowercase tags (e.g. "seo", "i18n", "content", "bug", "web", "api"). No "#".
- subtasks: ONLY if the work is genuinely several independent pieces a separate worker could take, split it. Each subtask has its own title, description, labels. Otherwise return an empty array.

Reply with ONLY a JSON object, no prose, no markdown fences:
{"title": "...", "description": "...", "labels": ["..."], "subtasks": [{"title": "...", "description": "...", "labels": ["..."]}]}`;

  async refine(
    organizationId: string,
    draft: { title: string; description?: string },
  ): Promise<RefinedTask> {
    const text = [draft.title, draft.description].filter(Boolean).join('\n\n');
    if (!text.trim()) {
      throw new BadRequestException('Nothing to refine.');
    }

    const aiProvider =
      await this.adapterFactory.getDefaultAIProvider(organizationId);
    if (!aiProvider) {
      throw new BadRequestException(
        'No AI provider configured. Add an AI key in Settings → AI.',
      );
    }

    const response = await aiProvider.complete(
      [{ role: 'user', content: `Draft:\n${text}` }],
      { systemPrompt: this.SYSTEM_PROMPT, maxTokens: 1500 },
    );

    return this.parse(response.content, draft);
  }

  /** Tolerant parse: strip fences, pull the first JSON object, clamp fields. */
  private parse(
    raw: string,
    fallback: { title: string; description?: string },
  ): RefinedTask {
    const cleaned = raw
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');

    let parsed: Record<string, unknown> = {};
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<
          string,
          unknown
        >;
      } catch (err) {
        this.logger.warn(
          `Composer returned non-JSON, falling back: ${(err as Error).message}`,
        );
      }
    }

    const asLabels = (v: unknown): string[] =>
      Array.isArray(v)
        ? v
            .map((l) => String(l).trim().toLowerCase().replace(/^#/, ''))
            .filter(Boolean)
            .slice(0, 5)
        : [];

    const asString = (v: unknown, def: string) =>
      typeof v === 'string' && v.trim() ? v.trim() : def;

    const subtasks = Array.isArray(parsed.subtasks)
      ? parsed.subtasks
          .filter(
            (s): s is Record<string, unknown> => !!s && typeof s === 'object',
          )
          .map((s) => ({
            title: asString(s.title, '').slice(0, 200),
            description: asString(s.description, ''),
            labels: asLabels(s.labels),
          }))
          .filter((s) => s.title)
          .slice(0, 10)
      : [];

    return {
      title: asString(parsed.title, fallback.title).slice(0, 200),
      description: asString(parsed.description, fallback.description ?? ''),
      labels: asLabels(parsed.labels),
      subtasks,
    };
  }
}
