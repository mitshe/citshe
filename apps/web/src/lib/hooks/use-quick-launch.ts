"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  useCreateSession,
  useRepositories,
  useAICredentials,
  useIntegrations,
} from "@/lib/api/hooks";

/**
 * One-tap terminal launch for the mobile-first flow. Creates a thread with
 * sensible defaults (a repo if the portal has exactly one, the default AI
 * provider, all connected integrations) and drops the user straight into the
 * terminal. The full New Thread dialog stays available for fine control.
 */
export function useQuickLaunch() {
  const router = useRouter();
  const createSession = useCreateSession();
  const { data: repositories = [] } = useRepositories();
  const { data: aiCredentials = [] } = useAICredentials();
  const { data: integrations = [] } = useIntegrations();
  const [launching, setLaunching] = useState(false);

  const activeRepos = repositories.filter((r) => r.isActive);
  const defaultCred =
    aiCredentials.find((c) => c.isDefault) || aiCredentials[0];
  const connectedIntegrationIds = integrations
    .filter((i) => i.status === "CONNECTED")
    .map((i) => i.id);

  const launch = async (opts?: { repositoryId?: string; name?: string }) => {
    if (launching || createSession.isPending) return;
    setLaunching(true);

    const repositoryIds = opts?.repositoryId
      ? [opts.repositoryId]
      : activeRepos.length === 1
        ? [activeRepos[0].id]
        : [];

    const repoName = opts?.repositoryId
      ? repositories.find((r) => r.id === opts.repositoryId)?.name
      : activeRepos.length === 1
        ? activeRepos[0].name
        : undefined;

    const name =
      opts?.name || (repoName ? `Terminal · ${repoName}` : "Terminal");

    try {
      const session = await createSession.mutateAsync({
        name,
        repositoryIds,
        integrationIds:
          connectedIntegrationIds.length > 0
            ? connectedIntegrationIds
            : undefined,
        aiCredentialId: defaultCred?.id,
      });
      router.push(`/sessions/${session.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to open terminal",
      );
      setLaunching(false);
    }
  };

  return {
    launch,
    launching: launching || createSession.isPending,
    /** True when the portal has repos to pick from (offer a chooser). */
    hasMultipleRepos: activeRepos.length > 1,
    repos: activeRepos,
  };
}
