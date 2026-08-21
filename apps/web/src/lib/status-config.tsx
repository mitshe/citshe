"use client";

import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Search,
  Eye,
  Ban,
} from "lucide-react";
import type { TaskStatus } from "@/lib/api/types";

// ============================================================================
// TASK STATUS CONFIGURATION
// ============================================================================

export const taskStatusConfig: Record<
  TaskStatus,
  {
    label: string;
    icon: React.ReactNode;
    variant: "default" | "secondary" | "outline" | "destructive";
    color: string;
  }
> = {
  PENDING: {
    label: "Open",
    icon: <Clock className="w-4 h-4" />,
    variant: "outline",
    color: "bg-warn/10 text-warn border-border",
  },
  QUEUED: {
    label: "Queued",
    icon: <Clock className="w-4 h-4" />,
    variant: "outline",
    color: "bg-warn/10 text-warn border-border",
  },
  ANALYZING: {
    label: "Analyzing",
    icon: <Search className="w-4 h-4" />,
    variant: "secondary",
    color: "bg-info/10 text-info border-border",
  },
  IN_PROGRESS: {
    label: "In Progress",
    icon: <Loader2 className="w-4 h-4" />,
    variant: "secondary",
    color: "bg-info/10 text-info border-border",
  },
  REVIEW: {
    label: "Review",
    icon: <Eye className="w-4 h-4" />,
    variant: "default",
    color: "bg-primary/10 text-primary border-border",
  },
  COMPLETED: {
    label: "Closed",
    icon: <CheckCircle2 className="w-4 h-4" />,
    variant: "default",
    color: "bg-ok/10 text-ok border-border",
  },
  FAILED: {
    label: "Failed",
    icon: <XCircle className="w-4 h-4" />,
    variant: "destructive",
    color: "bg-danger/10 text-danger border-border",
  },
  CANCELLED: {
    label: "Cancelled",
    icon: <Ban className="w-4 h-4" />,
    variant: "outline",
    color: "bg-muted text-muted-foreground border-border",
  },
};

// Helper to get task status config safely
export function getTaskStatus(status: string) {
  return (
    taskStatusConfig[status as TaskStatus] || {
      label: status,
      icon: <AlertCircle className="w-4 h-4" />,
      variant: "outline" as const,
      color: "bg-muted text-muted-foreground border-border",
    }
  );
}

// ============================================================================
// PROVIDER LABELS
// ============================================================================

export const providerLabels: Record<string, string> = {
  CLAUDE: "Claude",
  OPENROUTER: "OpenRouter",
  CLAUDE_CODE_LOCAL: "Claude Code",
  OPENCLAW: "OpenClaw",
};

// ============================================================================
// TRIGGER TYPE LABELS
// ============================================================================

export const triggerTypeLabels: Record<string, { label: string; color: string }> = {
  manual: { label: "Manual", color: "bg-info/10 text-info" },
  task: { label: "Task", color: "bg-warn/10 text-warn" },
  schedule: { label: "Scheduled", color: "bg-primary/10 text-primary" },
  webhook: { label: "Webhook", color: "bg-muted text-muted-foreground" },
  event: { label: "Event", color: "bg-ok/10 text-ok" },
  git_push: { label: "Git Push", color: "bg-muted text-muted-foreground" },
  git_mr: { label: "Merge Request", color: "bg-muted text-muted-foreground" },
};

// ============================================================================
// PRIORITY CONFIGURATION
// ============================================================================

export type Priority = "low" | "medium" | "high" | "urgent";

export const priorityConfig: Record<
  Priority,
  {
    label: string;
    variant: "default" | "secondary" | "outline" | "destructive";
    color: string;
  }
> = {
  low: {
    label: "Low",
    variant: "outline",
    color: "bg-muted text-muted-foreground border-border",
  },
  medium: {
    label: "Medium",
    variant: "secondary",
    color: "bg-info/10 text-info border-border",
  },
  high: {
    label: "High",
    variant: "default",
    color: "bg-warn/10 text-warn border-border",
  },
  urgent: {
    label: "Urgent",
    variant: "destructive",
    color: "bg-danger/10 text-danger border-border",
  },
};

// Helper to get priority config safely
export function getPriority(priority: string) {
  return (
    priorityConfig[priority as Priority] || {
      label: priority,
      variant: "outline" as const,
      color: "bg-muted text-muted-foreground border-border",
    }
  );
}
