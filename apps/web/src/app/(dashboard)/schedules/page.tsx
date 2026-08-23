"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Clock,
  Plus,
  Loader2,
  Play,
  Pencil,
  Trash2,
  MoreVertical,
  GitPullRequest,
  GitBranch as GitBranchIcon,
} from "lucide-react";
import {
  useSchedules,
  useCreateSchedule,
  useUpdateSchedule,
  useDeleteSchedule,
  useRunSchedule,
  useRepositories,
} from "@/lib/api/hooks";
import { toast } from "sonner";
import type { Schedule, DeliveryMode } from "@/lib/api/types";
import { describeCron, cronFromPreset, presetFromCron } from "./cron";

export default function SchedulesPage() {
  const { data: schedules = [], isLoading } = useSchedules();
  const runSchedule = useRunSchedule();
  const deleteSchedule = useDeleteSchedule();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Schedule | null>(null);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (s: Schedule) => {
    setEditing(s);
    setDialogOpen(true);
  };

  const isEmpty = !isLoading && schedules.length === 0;

  return (
    <div className="w-full max-w-[1000px] space-y-5 px-4 py-5 sm:px-6 sm:py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schedules</h1>
          <p className="text-sm text-muted-foreground">
            Recurring tasks — a prompt on a cron. Each run lands on the board.
          </p>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="mr-1.5 h-4 w-4" />
          New schedule
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-border bg-surface-card p-4"
            >
              <Skeleton className="h-4 w-48" />
              <Skeleton className="mt-2 h-3 w-32" />
            </div>
          ))}
        </div>
      ) : isEmpty ? (
        <EmptyState
          icon={<Clock />}
          title="No schedules yet"
          description="Automate recurring work — e.g. “every Monday 8:00, write a new SEO article”."
          action={
            <Button size="sm" onClick={openNew}>
              <Plus className="mr-1.5 h-4 w-4" />
              New schedule
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2">
          {schedules.map((s) => (
            <ScheduleRow
              key={s.id}
              schedule={s}
              onEdit={() => openEdit(s)}
              onDelete={() => setDeleteTarget(s)}
              onRun={async () => {
                try {
                  await runSchedule.mutateAsync(s.id);
                  toast.success("Run queued — check the board");
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Failed to run",
                  );
                }
              }}
            />
          ))}
        </ul>
      )}

      <ScheduleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleteTarget?.name}&rdquo; will stop running and be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deleteTarget) return;
                try {
                  await deleteSchedule.mutateAsync(deleteTarget.id);
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Failed to delete",
                  );
                } finally {
                  setDeleteTarget(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ScheduleRow({
  schedule,
  onEdit,
  onDelete,
  onRun,
}: {
  schedule: Schedule;
  onEdit: () => void;
  onDelete: () => void;
  onRun: () => void;
}) {
  const updateSchedule = useUpdateSchedule();

  const toggle = async (enabled: boolean) => {
    try {
      await updateSchedule.mutateAsync({ id: schedule.id, data: { enabled } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    }
  };

  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-surface-card px-4 py-3 transition-linear hover:border-border-strong">
      <span
        className={cnDot(schedule.enabled)}
        title={schedule.enabled ? "Active" : "Paused"}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {schedule.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {describeCron(schedule.cron)}
          {schedule.repository?.name ? ` · ${schedule.repository.name}` : ""}
          {schedule.lastRunAt
            ? ` · last run ${new Date(schedule.lastRunAt).toLocaleString()}`
            : " · never run"}
        </p>
      </div>
      <Switch
        checked={schedule.enabled}
        onCheckedChange={toggle}
        disabled={updateSchedule.isPending}
        aria-label="Enabled"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onRun}>
            <Play className="mr-2 h-4 w-4" />
            Run now
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function cnDot(enabled: boolean): string {
  return `h-2 w-2 shrink-0 rounded-full ${enabled ? "bg-ok" : "bg-text-subtle"}`;
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">
      {children}
    </p>
  );
}

type Preset = "hourly" | "daily" | "weekly" | "monthly" | "custom";
const WEEKDAYS = [
  { value: "1", label: "Mon" },
  { value: "2", label: "Tue" },
  { value: "3", label: "Wed" },
  { value: "4", label: "Thu" },
  { value: "5", label: "Fri" },
  { value: "6", label: "Sat" },
  { value: "0", label: "Sun" },
];

function ScheduleDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Schedule | null;
}) {
  const { data: repos = [] } = useRepositories();
  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();

  // Derive initial form from `editing` (or defaults). Keyed by dialog open so
  // switching between new/edit resets cleanly.
  const initial = useMemo(() => {
    if (editing) {
      const p = presetFromCron(editing.cron);
      return {
        name: editing.name,
        prompt: editing.prompt,
        repositoryId: editing.repositoryId ?? "",
        deliveryMode: editing.deliveryMode as DeliveryMode,
        preset: p.preset,
        time: p.time,
        weekday: p.weekday,
        day: p.day,
        rawCron: editing.cron,
      };
    }
    return {
      name: "",
      prompt: "",
      repositoryId: "",
      deliveryMode: "PR" as DeliveryMode,
      preset: "daily" as Preset,
      time: "08:00",
      weekday: "1",
      day: "1",
      rawCron: "0 8 * * *",
    };
  }, [editing]);

  const [name, setName] = useState(initial.name);
  const [prompt, setPrompt] = useState(initial.prompt);
  const [repositoryId, setRepositoryId] = useState(initial.repositoryId);
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(
    initial.deliveryMode,
  );
  const [preset, setPreset] = useState<Preset>(initial.preset);
  const [time, setTime] = useState(initial.time);
  const [weekday, setWeekday] = useState(initial.weekday);
  const [day, setDay] = useState(initial.day);
  const [rawCron, setRawCron] = useState(initial.rawCron);

  // Re-seed local state whenever the dialog (re)opens for a new target.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = editing?.id ?? "new";
  if (open && seededFor !== seedKey) {
    setName(initial.name);
    setPrompt(initial.prompt);
    setRepositoryId(initial.repositoryId);
    setDeliveryMode(initial.deliveryMode);
    setPreset(initial.preset);
    setTime(initial.time);
    setWeekday(initial.weekday);
    setDay(initial.day);
    setRawCron(initial.rawCron);
    setSeededFor(seedKey);
  }
  if (!open && seededFor !== null) setSeededFor(null);

  const cron =
    preset === "custom"
      ? rawCron.trim()
      : cronFromPreset({ preset, time, weekday, day });

  const busy = createSchedule.isPending || updateSchedule.isPending;

  const submit = async () => {
    if (!name.trim() || !prompt.trim() || !cron) return;
    const data = {
      name: name.trim(),
      prompt: prompt.trim(),
      cron,
      repositoryId: repositoryId || undefined,
      deliveryMode,
    };
    try {
      if (editing) {
        await updateSchedule.mutateAsync({ id: editing.id, data });
        toast.success("Schedule updated");
      } else {
        await createSchedule.mutateAsync(data);
        toast.success("Schedule created");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit schedule" : "New schedule"}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="space-y-1.5">
            <FieldLabel>Name</FieldLabel>
            <Input
              placeholder="e.g. Weekly SEO article"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <FieldLabel>Instruction</FieldLabel>
            <Textarea
              placeholder="What should the AI do each time this runs?"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <FieldLabel>Schedule</FieldLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={preset}
                onValueChange={(v) => setPreset(v as Preset)}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Every hour</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="custom">Custom cron</SelectItem>
                </SelectContent>
              </Select>

              {preset === "weekly" && (
                <Select value={weekday} onValueChange={setWeekday}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {preset === "monthly" && (
                <Select value={day} onValueChange={setDay}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 28 }, (_, i) => String(i + 1)).map(
                      (d) => (
                        <SelectItem key={d} value={d}>
                          {d}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              )}

              {(preset === "daily" ||
                preset === "weekly" ||
                preset === "monthly") && (
                <Input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-28"
                />
              )}

              {preset === "custom" && (
                <Input
                  placeholder="0 8 * * 1"
                  value={rawCron}
                  onChange={(e) => setRawCron(e.target.value)}
                  className="w-40 font-mono"
                />
              )}
            </div>
            <p className="text-xs text-text-subtle">
              {cron ? describeCron(cron) : "Enter a valid cron expression."}
              {" · Europe/Warsaw"}
            </p>
          </div>

          {repos.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <FieldLabel>Repository</FieldLabel>
                <Select
                  value={repositoryId || "none"}
                  onValueChange={(v) =>
                    setRepositoryId(v === "none" ? "" : v)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="No repository" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No repository</SelectItem>
                    {repos.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <FieldLabel>When the worker finishes</FieldLabel>
                <SegmentedControl<DeliveryMode>
                  aria-label="Delivery mode"
                  value={deliveryMode}
                  onChange={setDeliveryMode}
                  className="w-full"
                  options={[
                    { value: "PR", label: "Open a PR", icon: <GitPullRequest /> },
                    {
                      value: "DIRECT_PUSH",
                      label: "Push",
                      icon: <GitBranchIcon />,
                    },
                  ]}
                />
              </div>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            size="sm"
            onClick={submit}
            disabled={!name.trim() || !prompt.trim() || !cron || busy}
          >
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {editing ? "Save changes" : "Create schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
