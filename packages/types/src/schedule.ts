import type { DeliveryMode } from "./task";

/** A recurring schedule ("cron") that creates a Task each time it fires. */
export interface Schedule {
  id: string;
  organizationId: string;
  name: string;
  prompt: string;
  repositoryId: string | null;
  deliveryMode: DeliveryMode;
  /** 5-field cron expression, e.g. "0 8 * * 1". */
  cron: string;
  timezone: string;
  enabled: boolean;
  lastRunAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  repository?: { id: string; name: string } | null;
}

export interface CreateScheduleDto {
  name: string;
  prompt: string;
  cron: string;
  timezone?: string;
  repositoryId?: string;
  deliveryMode?: DeliveryMode;
  enabled?: boolean;
}

export interface UpdateScheduleDto {
  name?: string;
  prompt?: string;
  cron?: string;
  timezone?: string;
  repositoryId?: string | null;
  deliveryMode?: DeliveryMode;
  enabled?: boolean;
}
