import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import { queryKeys, useAuthToken } from "./shared";

export function useCliTokens() {
  const getToken = useAuthToken();
  return useQuery({
    queryKey: queryKeys.cliTokens.all,
    queryFn: async () => {
      const token = await getToken();
      const { tokens } = await api.cliTokens.list(token);
      return tokens;
    },
  });
}

export function useCreateCliToken() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const token = await getToken();
      return api.cliTokens.create(name, token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cliTokens.all });
    },
  });
}

export function useDeleteCliToken() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      await api.cliTokens.delete(id, token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cliTokens.all });
    },
  });
}
