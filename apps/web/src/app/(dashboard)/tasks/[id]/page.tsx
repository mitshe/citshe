"use client";

import { useParams, useRouter } from "next/navigation";
import { TaskDetail } from "../components/task-detail";

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  return (
    <TaskDetail
      taskId={taskId}
      variant="page"
      onDeleted={() => router.push("/tasks")}
    />
  );
}
