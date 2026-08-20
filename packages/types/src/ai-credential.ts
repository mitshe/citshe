// AI Credential types

// The engine is Claude Code (subscription, in-container). Panel-side small tasks
// use an API key: Claude API or OpenRouter.
export type AIProvider = "CLAUDE" | "CLAUDE_CODE_LOCAL" | "OPENROUTER";

export interface AICredential {
  id: string;
  organizationId: string;
  provider: AIProvider;
  isDefault: boolean;
  lastUsedAt: string | null;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  maskedKey?: string;
}

export interface CreateAICredentialDto {
  provider: AIProvider;
  apiKey: string;
  isDefault?: boolean;
}

export interface UpdateAICredentialDto {
  apiKey?: string;
  isDefault?: boolean;
}
