import { describe, it, expect } from "vitest";
import type {
  TaskUpdatePayload,
  IntegrationEventPayload,
  NotificationPayload,
  SocketEvent,
} from "./types";

describe("Socket Types", () => {
  describe("TaskUpdatePayload", () => {
    it("should have correct structure", () => {
      const payload: TaskUpdatePayload = {
        taskId: "task-123",
        status: "running",
        message: "Processing...",
        agentName: "CodeReviewAgent",
        progress: 50,
      };

      expect(payload.taskId).toBe("task-123");
      expect(payload.status).toBe("running");
      expect(payload.message).toBe("Processing...");
      expect(payload.agentName).toBe("CodeReviewAgent");
      expect(payload.progress).toBe(50);
    });

    it("should allow minimal required fields", () => {
      const payload: TaskUpdatePayload = {
        taskId: "task-123",
        status: "completed",
      };

      expect(payload.taskId).toBeDefined();
      expect(payload.status).toBeDefined();
      expect(payload.message).toBeUndefined();
    });
  });

  describe("IntegrationEventPayload", () => {
    it("should have correct structure for JIRA event", () => {
      const payload: IntegrationEventPayload = {
        type: "jira",
        event: "issue:created",
        data: {
          issueKey: "PROJ-123",
          summary: "New issue",
        },
        timestamp: "2024-01-20T10:00:00Z",
      };

      expect(payload.type).toBe("jira");
      expect(payload.event).toBe("issue:created");
      expect(payload.data.issueKey).toBe("PROJ-123");
    });

    it("should handle GitHub event", () => {
      const payload: IntegrationEventPayload = {
        type: "github",
        event: "pull_request:opened",
        data: {
          number: 42,
          title: "Feature branch",
          repository: "org/repo",
        },
        timestamp: "2024-01-20T10:00:00Z",
      };

      expect(payload.type).toBe("github");
      expect(payload.data.number).toBe(42);
    });
  });

  describe("NotificationPayload", () => {
    it("should have correct structure for success notification", () => {
      const payload: NotificationPayload = {
        id: "notif-123",
        type: "success",
        title: "Workflow completed",
        message: "Your workflow has finished successfully.",
        timestamp: "2024-01-20T10:00:00Z",
      };

      expect(payload.type).toBe("success");
      expect(payload.title).toBe("Workflow completed");
    });

    it("should handle error notification with data", () => {
      const payload: NotificationPayload = {
        id: "notif-456",
        type: "error",
        title: "Workflow failed",
        message: "The workflow execution encountered an error.",
        timestamp: "2024-01-20T10:00:00Z",
        data: {
          executionId: "exec-123",
          failedNode: "node-789",
        },
      };

      expect(payload.type).toBe("error");
      expect(payload.data?.executionId).toBe("exec-123");
    });
  });

  describe("SocketEvent types", () => {
    it("should include all expected event types", () => {
      const events: SocketEvent[] = [
        "task:update",
        "task:completed",
        "task:failed",
        "agent:log",
        "integration:event",
        "notification",
      ];

      expect(events).toHaveLength(6);
    });
  });
});
