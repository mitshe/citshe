"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import { queryKeys, useAuthToken } from "./shared";

/** Live queue snapshot — polled so the panel reflects workers as they run. */
export function useQueueOverview() {
  const getToken = useAuthToken();

  return useQuery({
    queryKey: queryKeys.orchestration.queue(),
    queryFn: async () => {
      const token = await getToken();
      return api.orchestration.queue(token);
    },
    refetchInterval: 5000,
  });
}

export function useSetQueuePaused() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (paused: boolean) => {
      const token = await getToken();
      return api.orchestration.setPaused(paused, token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.orchestration.queue(),
      });
    },
  });
}

/** Per-portal auto-pull toggle — workers pull QUEUED tasks when on. */
export function useSetAutoPull() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (autoPull: boolean) => {
      const token = await getToken();
      return api.orchestration.setAutoPull(autoPull, token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.orchestration.queue(),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}
