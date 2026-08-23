"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../client";
import type { CreateTaskDto, UpdateTaskDto } from "../types";
import { queryKeys, useAuthToken } from "./shared";

export function useTasks(projectId?: string) {
  const getToken = useAuthToken();

  return useQuery({
    queryKey: queryKeys.tasks.list(projectId),
    queryFn: async () => {
      const token = await getToken();
      const response = await api.tasks.list(token, projectId);
      return response.data ?? [];
    },
  });
}

export function useTask(id: string) {
  const getToken = useAuthToken();

  return useQuery({
    queryKey: queryKeys.tasks.detail(id),
    queryFn: async () => {
      const token = await getToken();
      const { task } = await api.tasks.get(id, token);
      return task;
    },
    enabled: !!id,
  });
}

export function useCreateTask() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateTaskDto) => {
      const token = await getToken();
      const { task } = await api.tasks.create(data, token);
      return task;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}

/** Ask AI to tighten a rough draft into a well-formed task (title/labels/subtasks). */
export function useRefineTask() {
  const getToken = useAuthToken();

  return useMutation({
    mutationFn: async (data: { title: string; description?: string }) => {
      const token = await getToken();
      return api.tasks.refine(data, token);
    },
  });
}

export function useUpdateTask() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateTaskDto }) => {
      const token = await getToken();
      const { task } = await api.tasks.update(id, data, token);
      return task;
    },
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      queryClient.setQueryData(queryKeys.tasks.detail(task.id), task);
    },
  });
}

export function useDeleteTask() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      await api.tasks.delete(id, token);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}

export function useProcessTask() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      const { task } = await api.tasks.process(id, token);
      return task;
    },
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      queryClient.setQueryData(queryKeys.tasks.detail(task.id), task);
    },
  });
}

export function useAddComment() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      const token = await getToken();
      await api.tasks.addComment(id, text, token);
      return id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    },
  });
}

export function useCloseTask() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      const { task } = await api.tasks.close(id, token);
      return task;
    },
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      queryClient.setQueryData(queryKeys.tasks.detail(task.id), task);
    },
  });
}

/** Move a task into the Queue column (status QUEUED + appended queueOrder). */
export function useEnqueueTask() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      const { task } = await api.tasks.enqueue(id, token);
      return task;
    },
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.orchestration.queue(),
      });
      queryClient.setQueryData(queryKeys.tasks.detail(task.id), task);
    },
  });
}

/** Reorder a task within the Queue column via a fractional queueOrder. */
export function useReorderQueue() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      taskId,
      queueOrder,
    }: {
      taskId: string;
      queueOrder: number;
    }) => {
      const token = await getToken();
      const { task } = await api.orchestration.reorderQueue(
        taskId,
        queueOrder,
        token,
      );
      return task;
    },
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.orchestration.queue(),
      });
      queryClient.setQueryData(queryKeys.tasks.detail(task.id), task);
    },
  });
}

export function useReopenTask() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      const { task } = await api.tasks.reopen(id, token);
      return task;
    },
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      queryClient.setQueryData(queryKeys.tasks.detail(task.id), task);
    },
  });
}

