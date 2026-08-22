"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type {
  CreateAICredentialDto,
  UpdateAICredentialDto,
} from "../types";
import { queryKeys, useAuthToken } from "./shared";

export function useAICredentials() {
  const getToken = useAuthToken();

  return useQuery({
    queryKey: queryKeys.aiCredentials.list(),
    queryFn: async () => {
      const token = await getToken();
      const { credentials } = await api.aiCredentials.list(token);
      return credentials;
    },
  });
}

export function useCreateAICredential() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateAICredentialDto) => {
      const token = await getToken();
      const { credential } = await api.aiCredentials.create(data, token);
      return credential;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.aiCredentials.all });
    },
  });
}

export function useUpdateAICredential() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateAICredentialDto;
    }) => {
      const token = await getToken();
      const { credential } = await api.aiCredentials.update(id, data, token);
      return credential;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.aiCredentials.all });
    },
  });
}

export function useDeleteAICredential() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      await api.aiCredentials.delete(id, token);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.aiCredentials.all });
    },
  });
}

/**
 * Fetch the OpenRouter credit balance for a credential. Only enable this for
 * OpenRouter credentials — other providers have no balance endpoint. A failed
 * fetch resolves to null and never breaks the page.
 */
export function useAICredentialCredits(id: string, enabled: boolean) {
  const getToken = useAuthToken();

  return useQuery({
    queryKey: queryKeys.aiCredentials.credits(id),
    enabled: enabled && !!id,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const token = await getToken();
      const { credits } = await api.aiCredentials.getCredits(id, token);
      return credits;
    },
  });
}

export function useTestAICredential() {
  const getToken = useAuthToken();

  return useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      return api.aiCredentials.test(id, token);
    },
  });
}

export function useTestAICredentialBeforeConnect() {
  const getToken = useAuthToken();

  return useMutation({
    mutationFn: async (data: { provider: string; apiKey?: string }) => {
      const token = await getToken();
      return api.aiCredentials.testBeforeConnect(data, token);
    },
  });
}
