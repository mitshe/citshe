/**
 * API Client for NestJS Backend
 */

import type {
  Task,
  QueueOverview,
  RefinedTask,
  Plugin,
  PluginStatus,
  PluginTestResult,
  PluginActionResult,
  PluginResources,
  PreviewDeployment,
  ConnectPluginDto,
  CreateTaskDto,
  UpdateTaskDto,
  Integration,
  CreateIntegrationDto,
  UpdateIntegrationDto,
  ApiKey,
  CreateApiKeyDto,
  CreateApiKeyResponse,
  AICredential,
  CreateAICredentialDto,
  UpdateAICredentialDto,
  OpenRouterCredits,
  Repository,
  RepoAnalysisResult,
  UpdateRepositoryDto,
  BulkUpdateRepositoriesDto,
  RemoteRepository,
  SyncRepositoriesResult,
  SyncAllRepositoriesResult,
  AgentSession,
  CreateSessionDto,
  UpdateSessionMetadataDto,
  RecreateSessionDto,
  Skill,
  CreateSkillDto,
  UpdateSkillDto,
} from "./types";

// API requests go through Next.js proxy (same-origin, no CORS issues)
// See next.config.ts rewrites: /api/v1/* -> backend
const API_BASE = "/api/v1";

interface ApiOptions extends RequestInit {
  token?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public data?: unknown,
  ) {
    super(`API Error: ${status} ${statusText}`);
    this.name = "ApiError";
  }
}

async function request<T>(
  endpoint: string,
  options: ApiOptions = {},
): Promise<T> {
  const { token, ...fetchOptions } = options;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, response.statusText, data);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

export const api = {
  tasks: {
    list: (token: string, repositoryId?: string) => {
      const params = repositoryId ? `?repositoryId=${repositoryId}` : "";
      return request<{
        data: Task[];
        meta: {
          total: number;
          page: number;
          limit: number;
          totalPages: number;
          hasNextPage: boolean;
          hasPreviousPage: boolean;
        };
      }>(`/tasks${params}`, { token });
    },

    get: (id: string, token: string) =>
      request<{ task: Task }>(`/tasks/${id}`, { token }),

    create: (data: CreateTaskDto, token: string) =>
      request<{ task: Task }>("/tasks", {
        method: "POST",
        body: JSON.stringify(data),
        token,
      }),

    refine: (
      data: { title: string; description?: string },
      token: string,
    ) =>
      request<RefinedTask>("/tasks/refine", {
        method: "POST",
        body: JSON.stringify(data),
        token,
      }),

    update: (id: string, data: UpdateTaskDto, token: string) =>
      request<{ task: Task }>(`/tasks/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
        token,
      }),

    delete: (id: string, token: string) =>
      request<void>(`/tasks/${id}`, {
        method: "DELETE",
        token,
      }),

    process: (id: string, token: string) =>
      request<{ task: Task }>(`/tasks/${id}/process`, {
        method: "POST",
        token,
      }),

    cancel: (id: string, token: string) =>
      request<{ task: Task }>(`/tasks/${id}/cancel`, {
        method: "POST",
        token,
      }),

    close: (id: string, token: string) =>
      request<{ task: Task; message: string }>(`/tasks/${id}/close`, {
        method: "POST",
        token,
      }),

    reopen: (id: string, token: string) =>
      request<{ task: Task; message: string }>(`/tasks/${id}/reopen`, {
        method: "POST",
        token,
      }),

    enqueue: (id: string, token: string) =>
      request<{ task: Task }>(`/tasks/${id}/queue`, {
        method: "POST",
        token,
      }),
  },

  integrations: {
    list: (token: string) =>
      request<{
        integrations: Integration[];
        githubApp?: { available: boolean };
      }>("/integrations", { token }),

    get: (id: string, token: string) =>
      request<{ integration: Integration }>(`/integrations/${id}`, { token }),

    create: (data: CreateIntegrationDto, token: string) =>
      request<{ integration: Integration }>("/integrations", {
        method: "POST",
        body: JSON.stringify(data),
        token,
      }),

    update: (id: string, data: UpdateIntegrationDto, token: string) =>
      request<{ integration: Integration }>(`/integrations/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
        token,
      }),

    delete: (id: string, token: string) =>
      request<void>(`/integrations/${id}`, {
        method: "DELETE",
        token,
      }),

    test: (id: string, token: string) =>
      request<{ success: boolean; message: string }>(
        `/integrations/${id}/test`,
        {
          method: "POST",
          token,
        },
      ),

    testBeforeConnect: (data: CreateIntegrationDto, token: string) =>
      request<{ success: boolean; message: string }>("/integrations/test", {
        method: "POST",
        body: JSON.stringify(data),
        token,
      }),

    githubAppStart: (token: string) =>
      request<{ url: string }>("/integrations/github/app/start", { token }),
  },

  apiKeys: {
    list: (token: string) =>
      request<{ apiKeys: ApiKey[] }>("/api-keys", { token }),

    create: (data: CreateApiKeyDto, token: string) =>
      request<CreateApiKeyResponse>("/api-keys", {
        method: "POST",
        body: JSON.stringify(data),
        token,
      }),

    delete: (id: string, token: string) =>
      request<void>(`/api-keys/${id}`, {
        method: "DELETE",
        token,
      }),
  },

  aiCredentials: {
    list: (token: string) =>
      request<{ credentials: AICredential[] }>("/ai-credentials", { token }),

    get: (id: string, token: string) =>
      request<{ credential: AICredential }>(`/ai-credentials/${id}`, { token }),

    create: (data: CreateAICredentialDto, token: string) =>
      request<{ credential: AICredential }>("/ai-credentials", {
        method: "POST",
        body: JSON.stringify(data),
        token,
      }),

    update: (id: string, data: UpdateAICredentialDto, token: string) =>
      request<{ credential: AICredential }>(`/ai-credentials/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
        token,
      }),

    delete: (id: string, token: string) =>
      request<void>(`/ai-credentials/${id}`, {
        method: "DELETE",
        token,
      }),

    test: (id: string, token: string) =>
      request<{ success: boolean; message: string }>(
        `/ai-credentials/${id}/test`,
        {
          method: "POST",
          token,
        },
      ),

    getCredits: (id: string, token: string) =>
      request<{ credits: OpenRouterCredits | null }>(
        `/ai-credentials/${id}/credits`,
        { token },
      ),

    testBeforeConnect: (
      data: { provider: string; apiKey?: string },
      token: string,
    ) =>
      request<{ success: boolean; message: string }>("/ai-credentials/test", {
        method: "POST",
        body: JSON.stringify(data),
        token,
      }),
  },

  repositories: {
    list: (token: string, active?: boolean) => {
      const params = active !== undefined ? `?active=${active}` : "";
      return request<{ repositories: Repository[] }>(`/repositories${params}`, {
        token,
      });
    },

    available: (token: string) =>
      request<{ repositories: Repository[] }>("/repositories/available", {
        token,
      }),

    get: (id: string, token: string) =>
      request<{ repository: Repository }>(`/repositories/${id}`, { token }),

    update: (id: string, data: UpdateRepositoryDto, token: string) =>
      request<{ repository: Repository }>(`/repositories/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
        token,
      }),

    bulkUpdate: (data: BulkUpdateRepositoriesDto, token: string) =>
      request<{ updated: number }>("/repositories/bulk", {
        method: "PATCH",
        body: JSON.stringify(data),
        token,
      }),

    bulkDelete: (ids: string[], token: string) =>
      request<{ result: { deleted: number } }>("/repositories/bulk", {
        method: "DELETE",
        body: JSON.stringify({ ids }),
        token,
      }),

    delete: (id: string, token: string) =>
      request<void>(`/repositories/${id}`, {
        method: "DELETE",
        token,
      }),

    listRemote: (token: string) =>
      request<{ repositories: RemoteRepository[] }>("/repositories/remote", {
        token,
      }),

    syncExisting: (token: string) =>
      request<{ result: SyncRepositoriesResult }>(
        "/repositories/sync/existing",
        {
          method: "POST",
          token,
        },
      ),

    syncOne: (id: string, token: string) =>
      request<{ synced: boolean; message: string }>(
        `/repositories/${id}/sync`,
        {
          method: "POST",
          token,
        },
      ),

    syncAll: (token: string) =>
      request<{ result: SyncAllRepositoriesResult }>("/repositories/sync", {
        method: "POST",
        token,
      }),

    syncSelective: (
      data: { integrationId: string; externalIds: string[] },
      token: string,
    ) =>
      request<{ result: SyncRepositoriesResult }>(
        "/repositories/sync/selective",
        {
          method: "POST",
          body: JSON.stringify(data),
          token,
        },
      ),

    syncIntegration: (integrationId: string, token: string) =>
      request<SyncRepositoriesResult>(`/repositories/sync/${integrationId}`, {
        method: "POST",
        token,
      }),

    listBranches: (id: string, token: string, search?: string) =>
      request<{ branches: Array<{ name: string; sha: string; isDefault: boolean; isProtected?: boolean }> }>(
        `/repositories/${id}/branches${search ? `?search=${encodeURIComponent(search)}` : ""}`,
        { token },
      ),

    analyze: (id: string, token: string) =>
      request<RepoAnalysisResult>(`/repositories/${id}/analyze`, {
        method: "POST",
        token,
      }),
  },

  sessions: {
    list: (token: string, status?: string) => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      const qs = params.toString();
      return request<{ sessions: AgentSession[] }>(
        `/sessions${qs ? `?${qs}` : ""}`,
        { token },
      );
    },

    get: (id: string, token: string) =>
      request<{ session: AgentSession }>(`/sessions/${id}`, { token }),

    create: (data: CreateSessionDto, token: string) =>
      request<{ session: AgentSession }>("/sessions", {
        method: "POST",
        body: JSON.stringify(data),
        token,
      }),

    update: (id: string, data: UpdateSessionMetadataDto, token: string) =>
      request<{ session: AgentSession }>(`/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
        token,
      }),

    recreate: (id: string, data: RecreateSessionDto, token: string) =>
      request<{ session: AgentSession }>(`/sessions/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
        token,
      }),

    delete: (id: string, token: string) =>
      request<void>(`/sessions/${id}`, {
        method: "DELETE",
        token,
      }),

    startTerminal: (
      id: string,
      token: string,
      options?: { terminalId?: string; cmd?: string[] },
    ) =>
      request<{ terminalId: string; status: string; buffer?: string }>(
        `/sessions/${id}/terminals`,
        {
          method: "POST",
          body: options ? JSON.stringify(options) : undefined,
          token,
        },
      ),

    closeTerminal: (id: string, terminalId: string, token: string) =>
      request<{ status: string }>(
        `/sessions/${id}/terminals/${encodeURIComponent(terminalId)}`,
        {
          method: "DELETE",
          token,
        },
      ),

    pause: (id: string, token: string) =>
      request<{ status: string }>(`/sessions/${id}/pause`, {
        method: "POST",
        token,
      }),

    resume: (id: string, token: string) =>
      request<{ status: string }>(`/sessions/${id}/resume`, {
        method: "POST",
        token,
      }),

    stop: (id: string, token: string) =>
      request<{ status: string }>(`/sessions/${id}/stop`, {
        method: "POST",
        token,
      }),

    clone: (id: string, token: string) =>
      request<{ session: AgentSession }>(`/sessions/${id}/clone`, {
        method: "POST",
        token,
      }),

    getFiles: (id: string, token: string, path?: string) => {
      const qs = path ? `?path=${encodeURIComponent(path)}` : "";
      return request<{ files: string[] }>(`/sessions/${id}/files${qs}`, {
        token,
      });
    },

    getGitStatus: (id: string, token: string) =>
      request<{ statuses: Array<{ path: string; status: string }> }>(
        `/sessions/${id}/git-status`,
        { token },
      ),

    readFile: (id: string, filePath: string, token: string) =>
      request<{ path: string; content: string }>(
        `/sessions/${id}/file?path=${encodeURIComponent(filePath)}`,
        { token },
      ),

    writeFile: (id: string, path: string, content: string, token: string) =>
      request<{ status: string }>(`/sessions/${id}/file`, {
        method: "POST",
        body: JSON.stringify({ path, content }),
        token,
      }),

    deleteFile: (id: string, path: string, token: string) =>
      request<{ status: string }>(
        `/sessions/${id}/file?path=${encodeURIComponent(path)}`,
        {
          method: "DELETE",
          token,
        },
      ),

    getBrowserInfo: (id: string, token: string) =>
      request<{ wsUrl: string; httpUrl: string; status: string }>(
        `/sessions/${id}/browser`,
        { token },
      ),

    pushAndCreatePR: (
      id: string,
      data: { title?: string; description?: string; targetBranch?: string },
      token: string,
    ) =>
      request<{
        branch: string;
        pushResult: string;
        pr: { id: number; title: string; webUrl: string; status: string };
      }>(`/sessions/${id}/push-and-pr`, {
        method: "POST",
        body: JSON.stringify(data),
        token,
      }),
  },

  skills: {
    list: (token: string) =>
      request<{ skills: Skill[] }>("/skills", { token }),

    get: (id: string, token: string) =>
      request<{ skill: Skill }>(`/skills/${id}`, { token }),

    create: (data: CreateSkillDto, token: string) =>
      request<{ skill: Skill }>("/skills", {
        method: "POST",
        body: JSON.stringify(data),
        token,
      }),

    update: (id: string, data: UpdateSkillDto, token: string) =>
      request<{ skill: Skill }>(`/skills/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
        token,
      }),

    delete: (id: string, token: string) =>
      request<void>(`/skills/${id}`, {
        method: "DELETE",
        token,
      }),

    importGitHub: (data: { repo: string; path?: string; branch?: string }, token: string) =>
      request<{ imported: number; skills: string[] }>("/skills/import-github", {
        method: "POST",
        body: JSON.stringify(data),
        token,
      }),
  },

  orchestration: {
    queue: (token: string) =>
      request<QueueOverview>("/orchestration/queue", { token }),

    setPaused: (paused: boolean, token: string) =>
      request<{ queuePaused: boolean }>("/orchestration/queue/pause", {
        method: "POST",
        body: JSON.stringify({ paused }),
        token,
      }),

    setAutoPull: (autoPull: boolean, token: string) =>
      request<{ autoPull: boolean }>("/orchestration/queue/auto-pull", {
        method: "POST",
        body: JSON.stringify({ autoPull }),
        token,
      }),

    reorderQueue: (taskId: string, queueOrder: number, token: string) =>
      request<{ task: Task }>("/orchestration/queue/reorder", {
        method: "POST",
        body: JSON.stringify({ taskId, queueOrder }),
        token,
      }),
  },

  plugins: {
    list: (token: string) =>
      request<{ plugins: Plugin[] }>("/plugins", { token }),

    connect: (data: ConnectPluginDto, token: string) =>
      request<{ plugin: Plugin }>("/plugins", {
        method: "POST",
        body: JSON.stringify(data),
        token,
      }),

    test: (data: ConnectPluginDto, token: string) =>
      request<PluginTestResult>("/plugins/test", {
        method: "POST",
        body: JSON.stringify(data),
        token,
      }),

    status: (type: string, token: string) =>
      request<{ status: PluginStatus | null }>(`/plugins/${type}/status`, {
        token,
      }),

    action: (
      type: string,
      data: { actionId: string; input?: Record<string, unknown> },
      token: string,
    ) =>
      request<PluginActionResult>(`/plugins/${type}/action`, {
        method: "POST",
        body: JSON.stringify(data),
        token,
      }),

    previews: (repo: string | undefined, token: string) =>
      request<{ previews: PreviewDeployment[] }>(
        `/plugins/previews${repo ? `?repo=${encodeURIComponent(repo)}` : ""}`,
        { token },
      ),

    resources: (type: string, token: string) =>
      request<PluginResources>(`/plugins/${type}/resources`, { token }),

    updateConfig: (
      type: string,
      partial: Record<string, unknown>,
      token: string,
    ) =>
      request<{ ok: boolean }>(`/plugins/${type}/config`, {
        method: "PUT",
        body: JSON.stringify(partial),
        token,
      }),

    delete: (id: string, token: string) =>
      request<void>(`/plugins/${id}`, { method: "DELETE", token }),
  },
};
