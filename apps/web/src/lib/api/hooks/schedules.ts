import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type { CreateScheduleDto, UpdateScheduleDto } from "../types";
import { queryKeys, useAuthToken } from "./shared";

export function useSchedules() {
  const getToken = useAuthToken();
  return useQuery({
    queryKey: queryKeys.schedules.all,
    queryFn: async () => {
      const token = await getToken();
      const { schedules } = await api.schedules.list(token);
      return schedules;
    },
  });
}

export function useCreateSchedule() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateScheduleDto) => {
      const token = await getToken();
      const { schedule } = await api.schedules.create(data, token);
      return schedule;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules.all });
    },
  });
}

export function useUpdateSchedule() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateScheduleDto;
    }) => {
      const token = await getToken();
      const { schedule } = await api.schedules.update(id, data, token);
      return schedule;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules.all });
    },
  });
}

export function useDeleteSchedule() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      await api.schedules.delete(id, token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules.all });
    },
  });
}

export function useRunSchedule() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      await api.schedules.runNow(id, token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}
