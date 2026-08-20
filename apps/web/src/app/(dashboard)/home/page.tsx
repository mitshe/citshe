"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  KeyRound,
  Terminal,
  Pause,
  Play,
  Cpu,
  Blocks,
  ListPlus,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthContext } from "@/lib/auth";
import {
  useTasks,
  useAICredentials,
  useSessions,
  useQueueOverview,
  useSetQueuePaused,
  usePlugins,
  usePluginStatus,
} from "@/lib/api/hooks";
import { OrgSwitcher } from "@/components/layout/org-switcher";
import { PluginCard } from "@/components/plugins/plugin-card";
import { pluginCatalog } from "@/lib/plugin-catalog";
import { Button } from "@/components/ui/button";
import { useQuickLaunch } from "@/lib/hooks/use-quick-launch";
import type { Task, TaskStatus, QueueOverview, HealthState } from "@citshe/types";

const ACTIVE_STATUSES: TaskStatus[] = ["PENDING", "QUEUED", "ANALYZING", "IN_PROGRESS", "REVIEW"];
const LIVE_WORKER_STATUSES: TaskStatus[] = ["ANALYZING", "IN_PROGRESS"];

export default function HomePage() {
  const { currentOrg } = useAuthContext();
  const { data: tasks = [], isLoading: loadingTasks } = useTasks();
  const { data: sessions = [] } = useSessions();
  const { data: credentials = [] } = useAICredentials();
  const { data: queue } = useQueueOverview();
  const { data: plugins = [] } = usePlugins();
  const quickLaunch = useQuickLaunch();

  const hasCredentials = credentials.length > 0;
  const connectedTypes = useMemo(
    () => new Set(plugins.map((p) => p.type)),
    [plugins],
  );

  const runningThreads = useMemo(() => {
    const list = sessions as Array<{ id: string; name: string; status: string }>;
    return list.filter((s) => s.status === "RUNNING" || s.status === "CREATING");
  }, [sessions]);

  const active = useMemo(
    () =>
      (tasks as Task[])
        .filter((t) => ACTIVE_STATUSES.includes(t.status))
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
    [tasks],
  );

  const greeting =
    new Date().getHours() < 12
      ? "Good morning"
      : new Date().getHours() < 18
        ? "Good afternoon"
        : "Good evening";

  const cloudflareConnected = connectedTypes.has("CLOUDFLARE");

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-8 space-y-6">
      {/* Portal selector — mobile only; desktop has it in the sidebar */}
      <div className="sm:hidden">
        <OrgSwitcher />
      </div>

      {/* Status header — the "is it live" line (Vercel-style) */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-light tracking-tight text-foreground/90">
            {currentOrg?.name ?? greeting}
          </h1>
        </div>
        {cloudflareConnected ? (
          <StatusLine />
        ) : (
          <p className="text-sm text-muted-foreground">
            {greeting}. Connect your stack to see deploys and health here.
          </p>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-2">
        <ActionCard
          onClick={() => quickLaunch.launch()}
          icon={
            quickLaunch.launching ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Terminal className="h-5 w-5" />
            )
          }
          title="Terminal"
          subtitle="Open a thread"
          accent="text-emerald-500"
          disabled={!hasCredentials}
        />
        <ActionCard
          href="/tasks"
          icon={<ListPlus className="h-5 w-5" />}
          title="Task"
          subtitle="Delegate"
          accent="text-amber-500"
        />
        <ActionCard
          href="/plugins"
          icon={<Blocks className="h-5 w-5" />}
          title="Plugins"
          subtitle="Your stack"
          accent="text-blue-500"
        />
      </div>

      {!hasCredentials && <MissingCredentials />}

      {/* Stack — plugin status cards + connect tiles */}
      <section className="space-y-2">
        <SectionLabel>Stack</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          {pluginCatalog.map((def) =>
            connectedTypes.has(def.type) ? (
              <PluginCard key={def.type} type={def.type} />
            ) : (
              <Link
                key={def.type}
                href="/plugins"
                className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-muted/10 px-4 py-3.5 transition-colors hover:border-primary/40 hover:bg-muted/30"
              >
                <span className={def.accent}>{def.icon}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">Connect {def.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {def.tagline}
                  </p>
                </div>
              </Link>
            ),
          )}
        </div>
      </section>

      {/* Workers */}
      {queue && <WorkersStrip queue={queue} />}

      {/* Live threads */}
      {runningThreads.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <SectionLabel>Live threads</SectionLabel>
            <Link
              href="/sessions"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              All threads →
            </Link>
          </div>
          <div className="space-y-2">
            {runningThreads.map((s) => (
              <Link
                key={s.id}
                href={`/sessions/${s.id}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-background/50 px-3.5 py-3 hover:bg-muted/40"
              >
                <Terminal className="h-4 w-4 shrink-0 text-emerald-500" />
                <span className="flex-1 truncate text-sm">{s.name}</span>
                <span className="flex items-center gap-1.5 shrink-0 text-[11px] font-medium text-emerald-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {s.status === "CREATING" ? "Starting" : "Live"}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Active tasks */}
      {active.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <SectionLabel>In progress</SectionLabel>
            <Link
              href="/tasks"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              All tasks →
            </Link>
          </div>
          <div className="space-y-2">
            {active.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </div>
        </section>
      )}

      {!loadingTasks &&
        active.length === 0 &&
        runningThreads.length === 0 &&
        hasCredentials && (
          <p className="pt-2 text-center text-sm text-muted-foreground">
            Nothing running. Open a terminal or delegate a task.
          </p>
        )}
    </div>
  );
}

/** The one-line "is it live" from the Cloudflare plugin. */
function StatusLine() {
  const { data: status, isLoading } = usePluginStatus("CLOUDFLARE");

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking deploy status…
      </p>
    );
  }
  if (!status) return null;

  const dot: Record<HealthState, string> = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    down: "bg-red-500",
    idle: "bg-muted-foreground/50",
  };
  const deploy = status.metrics.find((m) => m.label === "Last deploy");

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="flex items-center gap-1.5 font-medium">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            dot[status.headline.state],
          )}
        />
        {status.headline.label}
      </span>
      {deploy && (
        <span className="text-muted-foreground">
          · deployed {deploy.value}
          {deploy.hint ? ` · ${deploy.hint}` : ""}
        </span>
      )}
    </p>
  );
}

function ActionCard({
  href,
  onClick,
  icon,
  title,
  subtitle,
  accent,
  disabled,
}: {
  href?: string;
  onClick?: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  accent: string;
  disabled?: boolean;
}) {
  const inner = (
    <div
      className={cn(
        "flex flex-col items-center gap-1 rounded-xl border border-border bg-background/50 px-2 py-3.5 text-center transition-colors",
        disabled
          ? "opacity-50"
          : "hover:bg-muted/40 hover:border-primary/30 cursor-pointer",
      )}
    >
      <span className={accent}>{icon}</span>
      <span className="text-sm font-medium">{title}</span>
      <span className="text-[11px] text-muted-foreground">{subtitle}</span>
    </div>
  );
  if (disabled) return inner;
  if (href) return <Link href={href}>{inner}</Link>;
  return (
    <button onClick={onClick} className="text-left">
      {inner}
    </button>
  );
}

function WorkersStrip({ queue }: { queue: QueueOverview }) {
  const setPaused = useSetQueuePaused();
  const waiting = queue.pending.length + queue.queued.length;
  const active = queue.runningWorkers;

  if (active === 0 && waiting === 0 && !queue.queuePaused) return null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-background/50 px-3.5 py-2.5">
      <Cpu
        className={cn(
          "h-4 w-4 shrink-0",
          active > 0 ? "text-emerald-500" : "text-muted-foreground",
        )}
      />
      <div className="flex-1 text-sm">
        <span className="font-medium">
          {active}/{queue.maxWorkers}
        </span>{" "}
        <span className="text-muted-foreground">
          worker{active === 1 ? "" : "s"} running
        </span>
        {waiting > 0 && (
          <span className="text-muted-foreground"> · {waiting} waiting</span>
        )}
        {queue.queuePaused && <span className="text-amber-500"> · paused</span>}
      </div>
      <button
        type="button"
        disabled={setPaused.isPending}
        onClick={() => setPaused.mutate(!queue.queuePaused)}
        className={cn(
          "flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
          queue.queuePaused
            ? "text-emerald-600 hover:bg-emerald-500/10"
            : "text-muted-foreground hover:bg-muted/60",
        )}
      >
        {queue.queuePaused ? (
          <>
            <Play className="h-3.5 w-3.5" />
            Resume
          </>
        ) : (
          <>
            <Pause className="h-3.5 w-3.5" />
            Pause
          </>
        )}
      </button>
    </div>
  );
}

const STATUS_META: Record<
  TaskStatus,
  { label: string; icon: React.ReactNode; className: string }
> = {
  PENDING: { label: "Open", icon: <Clock className="h-3.5 w-3.5" />, className: "text-muted-foreground" },
  QUEUED: { label: "Queued", icon: <Clock className="h-3.5 w-3.5" />, className: "text-amber-500" },
  ANALYZING: { label: "Analyzing", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, className: "text-blue-500" },
  IN_PROGRESS: { label: "Working", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, className: "text-emerald-500" },
  REVIEW: { label: "In review", icon: <Clock className="h-3.5 w-3.5" />, className: "text-amber-500" },
  COMPLETED: { label: "Closed", icon: <CheckCircle2 className="h-3.5 w-3.5" />, className: "text-emerald-500" },
  FAILED: { label: "Failed", icon: <XCircle className="h-3.5 w-3.5" />, className: "text-destructive" },
  CANCELLED: { label: "Cancelled", icon: <XCircle className="h-3.5 w-3.5" />, className: "text-muted-foreground" },
};

function TaskRow({ task }: { task: Task }) {
  const meta = STATUS_META[task.status];
  const liveWorker =
    !!task.sessionId && LIVE_WORKER_STATUSES.includes(task.status);
  const href = liveWorker ? `/sessions/${task.sessionId}` : `/tasks/${task.id}`;
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-border bg-background/50 px-3.5 py-3 hover:bg-muted/40"
    >
      <span className={cn("shrink-0", meta.className)}>{meta.icon}</span>
      <span className="flex-1 truncate text-sm">{task.title}</span>
      {liveWorker && (
        <span className="flex items-center gap-1 shrink-0 text-[11px] font-medium text-emerald-500">
          <Terminal className="h-3.5 w-3.5" />
          Watch
        </span>
      )}
      <span className={cn("shrink-0 text-[11px] font-medium", meta.className)}>
        {meta.label}
      </span>
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
      {children}
    </p>
  );
}

function MissingCredentials() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-5 text-center space-y-3">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
        <KeyRound className="h-5 w-5 text-primary" />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Connect AI for this portal</h2>
        <p className="text-sm text-muted-foreground">
          Add an API key so AI can run tasks and power your terminals.
        </p>
      </div>
      <Button asChild size="sm">
        <Link href="/settings/ai">
          <Sparkles className="mr-1.5 h-4 w-4" />
          Add AI key
        </Link>
      </Button>
    </div>
  );
}
