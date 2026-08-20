"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type { ConnectPluginDto } from "../types";
import { queryKeys, useAuthToken } from "./shared";

export function usePlugins() {
  const getToken = useAuthToken();

  return useQuery({
    queryKey: queryKeys.plugins.list(),
    queryFn: async () => {
      const token = await getToken();
      const { plugins } = await api.plugins.list(token);
      return plugins;
    },
  });
}

/** Live, normalized status for one plugin type. Polled while mounted. */
export function usePluginStatus(type: string, enabled = true) {
  const getToken = useAuthToken();

  return useQuery({
    queryKey: queryKeys.plugins.status(type),
    queryFn: async () => {
      const token = await getToken();
      const { status } = await api.plugins.status(type, token);
      return status;
    },
    enabled,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useConnectPlugin() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: ConnectPluginDto) => {
      const token = await getToken();
      const { plugin } = await api.plugins.connect(data, token);
      return plugin;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });
    },
  });
}

export function useTestPlugin() {
  const getToken = useAuthToken();

  return useMutation({
    mutationFn: async (data: ConnectPluginDto) => {
      const token = await getToken();
      return api.plugins.test(data, token);
    },
  });
}

export function useDeletePlugin() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      await api.plugins.delete(id, token);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });
    },
  });
}

/** List a plugin's resources + current selection (for the picker dialog). */
export function usePluginResources(type: string, enabled = true) {
  const getToken = useAuthToken();

  return useQuery({
    queryKey: [...queryKeys.plugins.all, "resources", type],
    queryFn: async () => {
      const token = await getToken();
      return api.plugins.resources(type, token);
    },
    enabled,
  });
}

/** Save the per-portal resource selection. Refreshes status. */
export function useSetPluginSelection(type: string) {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (selection: Record<string, string[]>) => {
      const token = await getToken();
      return api.plugins.updateConfig(type, { selection }, token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });
    },
  });
}

/** Recent preview deployments (optionally for a repo). Test on a real deploy. */
export function usePreviews(repo?: string, enabled = true) {
  const getToken = useAuthToken();

  return useQuery({
    queryKey: queryKeys.plugins.previews(repo),
    queryFn: async () => {
      const token = await getToken();
      const { previews } = await api.plugins.previews(repo, token);
      return previews;
    },
    enabled,
    staleTime: 30_000,
  });
}

/** Run a plugin write-action (redeploy, add subdomain…). Refreshes status. */
export function useRunPluginAction(type: string) {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      actionId: string;
      input?: Record<string, unknown>;
    }) => {
      const token = await getToken();
      return api.plugins.action(type, data, token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.plugins.status(type),
      });
    },
  });
}
