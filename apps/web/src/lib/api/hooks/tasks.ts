"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { api } from "../client";
import type { CreateTaskDto, UpdateTaskDto, Task } from "../types";
import { queryKeys, useAuthToken } from "./shared";

type TasksQueryOptions = Pick<
  UseQueryOptions<Task[]>,
  "refetchInterval"
>;

export function useTasks(projectId?: string, opts?: TasksQueryOptions) {
  const getToken = useAuthToken();

  return useQuery<Task[]>({
    queryKey: queryKeys.tasks.list(projectId),
    queryFn: async () => {
      const token = await getToken();
      const response = await api.tasks.list(token, projectId);
      return response.data ?? [];
    },
    // Poll while something is actively building so the home hero / board update
    // live without a manual refresh.
    refetchInterval: opts?.refetchInterval,
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

/** The task a worker session is running (or null). Powers the session's Progress tab. */
export function useTaskBySession(sessionId: string, enabled = true) {
  const getToken = useAuthToken();

  return useQuery({
    queryKey: queryKeys.tasks.bySession(sessionId),
    queryFn: async () => {
      const token = await getToken();
      const { task } = await api.tasks.bySession(sessionId, token);
      return task;
    },
    enabled: enabled && !!sessionId,
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

/** Start a "New project" build task immediately (ignores autoPull). */
export function useBuildTask() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      const { task } = await api.tasks.build(id, token);
      return task;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.orchestration.queue(),
      });
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

