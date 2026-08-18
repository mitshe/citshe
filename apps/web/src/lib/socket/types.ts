export interface TaskUpdatePayload {
  taskId: string;
  status: string;
  message?: string;
  agentName?: string;
  progress?: number;
}

export interface IntegrationEventPayload {
  type: "jira" | "github" | "gitlab" | "slack";
  event: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface NotificationPayload {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface SessionStatusPayload {
  sessionId: string;
  status: string;
  error?: string;
}

export interface SessionOutputPayload {
  sessionId: string;
  data: string;
}

export type SocketEvent =
  | "task:update"
  | "task:completed"
  | "task:failed"
  | "agent:log"
  | "integration:event"
  | "notification"
  | "session:status"
  | "session:output";

export interface SocketEventPayloads {
  "task:update": TaskUpdatePayload;
  "task:completed": { taskId: string; result: Record<string, unknown> };
  "task:failed": { taskId: string; reason: string };
  "agent:log": {
    taskId: string;
    agentName: string;
    action: string;
    details?: Record<string, unknown>;
    timestamp: string;
  };
  "integration:event": IntegrationEventPayload;
  notification: NotificationPayload;
  "session:status": SessionStatusPayload;
  "session:output": SessionOutputPayload;
}
