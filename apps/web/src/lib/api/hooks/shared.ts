"use client";

import { useAuth } from "@/lib/auth";

export const queryKeys = {
  projects: {
    all: ["projects"] as const,
    list: () => [...queryKeys.projects.all, "list"] as const,
    detail: (id: string) => [...queryKeys.projects.all, "detail", id] as const,
  },
  tasks: {
    all: ["tasks"] as const,
    list: (projectId?: string) =>
      [...queryKeys.tasks.all, "list", { projectId }] as const,
    detail: (id: string) => [...queryKeys.tasks.all, "detail", id] as const,
  },
  orchestration: {
    all: ["orchestration"] as const,
    queue: () => [...queryKeys.orchestration.all, "queue"] as const,
  },
  integrations: {
    all: ["integrations"] as const,
    list: () => [...queryKeys.integrations.all, "list"] as const,
    detail: (id: string) =>
      [...queryKeys.integrations.all, "detail", id] as const,
  },
  apiKeys: {
    all: ["apiKeys"] as const,
    list: () => [...queryKeys.apiKeys.all, "list"] as const,
  },
  aiCredentials: {
    all: ["aiCredentials"] as const,
    list: () => [...queryKeys.aiCredentials.all, "list"] as const,
    detail: (id: string) =>
      [...queryKeys.aiCredentials.all, "detail", id] as const,
  },
  repositories: {
    all: ["repositories"] as const,
    list: (active?: boolean) =>
      [...queryKeys.repositories.all, "list", { active }] as const,
    available: () => [...queryKeys.repositories.all, "available"] as const,
    detail: (id: string) =>
      [...queryKeys.repositories.all, "detail", id] as const,
  },
  sessions: {
    all: ["sessions"] as const,
    list: (status?: string, projectId?: string) =>
      [...queryKeys.sessions.all, "list", { status, projectId }] as const,
    detail: (id: string) =>
      [...queryKeys.sessions.all, "detail", id] as const,
    files: (id: string) =>
      [...queryKeys.sessions.all, "files", id] as const,
  },
  skills: {
    all: ["skills"] as const,
    list: () => [...queryKeys.skills.all, "list"] as const,
    detail: (id: string) => [...queryKeys.skills.all, "detail", id] as const,
  },
};

export function useAuthToken() {
  const { getToken } = useAuth();
  return async () => {
    const token = await getToken();
    if (!token) throw new Error("Not authenticated");
    return token;
  };
}
