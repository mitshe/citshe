"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Terminal,
  Pause,
  Play,
  Cpu,
  Blocks,
  ListPlus,
  KeyRound,
  FolderGit2,
  ArrowRight,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthContext } from "@/lib/auth";
import {
  useTasks,
  useAICredentials,
  useSessions,
  useRepositories,
  useQueueOverview,
  useSetQueuePaused,
  usePlugins,
  usePluginStatus,
} from "@/lib/api/hooks";
import { OrgSwitcher } from "@/components/layout/org-switcher";
import { PluginCard } from "@/components/plugins/plugin-card";
import { pluginCatalog } from "@/lib/plugin-catalog";
import { useQuickLaunch } from "@/lib/hooks/use-quick-launch";
import type { Task, TaskStatus, QueueOverview, HealthState } from "@citshe/types";

const ACTIVE_STATUSES: TaskStatus[] = ["PENDING", "QUEUED", "ANALYZING", "IN_PROGRESS", "REVIEW"];
const LIVE_WORKER_STATUSES: TaskStatus[] = ["ANALYZING", "IN_PROGRESS"];

export default function HomePage() {
  const { currentOrg } = useAuthContext();
  const { data: tasks = [] } = useTasks();
  const { data: sessions = [] } = useSessions();
  const { data: credentials = [] } = useAICredentials();
  const { data: repos = [] } = useRepositories();
  const { data: queue } = useQueueOverview();
  const { data: plugins = [] } = usePlugins();
  const quickLaunch = useQuickLaunch();

  const hasCredentials = credentials.length > 0;
  const hasRepo = repos.length > 0;
  const connectedTypes = useMemo(
    () => new Set(plugins.map((p) => p.type)),
    [plugins],
  );
  const hasPlugin = plugins.length > 0;

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

  // A portal is "set up" once AI + a repo are connected. Before that we show a
  // calm, guided checklist instead of a wall of scattered "connect X" boxes.
  const isSetUp = hasCredentials && hasRepo;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10 space-y-8">
      {/* Portal selector — mobile only; desktop has it in the sidebar */}
      <div className="sm:hidden">
        <OrgSwitcher />
      </div>

      {/* Header */}
      <header className="space-y-1.5">
        <p className="text-sm text-muted-foreground">{greeting}</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {currentOrg?.name ?? "Your portal"}
        </h1>
        {isSetUp && connectedTypes.has("CLOUDFLARE") ? (
          <StatusLine />
        ) : isSetUp ? (
          <p className="text-sm text-muted-foreground">
            Everything wired up. Delegate a task or open a terminal.
          </p>
        ) : null}
      </header>

      {!isSetUp ? (
        <SetupChecklist
          hasCredentials={hasCredentials}
          hasRepo={hasRepo}
          hasPlugin={hasPlugin}
        />
      ) : (
        <>
          {/* Quick actions */}
          <div className="grid grid-cols-3 gap-3">
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
              accent="text-emerald-500"
            />
            <ActionCard
              href="/tasks"
              icon={<ListPlus className="h-5 w-5" />}
              title="New task"
              accent="text-amber-500"
            />
            <ActionCard
              href="/repos"
              icon={<FolderGit2 className="h-5 w-5" />}
              title="Repos"
              accent="text-violet-500"
            />
          </div>

          {/* Stack — only what's connected; a single quiet link to add more */}
          {hasPlugin && (
            <section className="space-y-2.5">
              <SectionHeader label="Stack" href="/plugins" cta="Manage" />
              <div className="grid gap-3 sm:grid-cols-2">
                {pluginCatalog
                  .filter((def) => connectedTypes.has(def.type))
                  .map((def) => (
                    <PluginCard key={def.type} type={def.type} />
                  ))}
              </div>
            </section>
          )}
          {!hasPlugin && (
            <Link
              href="/plugins"
              className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-muted/10 px-4 py-3.5 transition-colors hover:border-primary/40 hover:bg-muted/30"
            >
              <Blocks className="h-5 w-5 text-blue-500" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Connect your stack</p>
                <p className="text-xs text-muted-foreground">
                  Cloudflare, Neon, Google Ads — see deploys & health here
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          )}

          {/* Work */}
          {queue && <WorkersStrip queue={queue} />}

          {runningThreads.length > 0 && (
            <section className="space-y-2.5">
              <SectionHeader label="Live terminals" href="/sessions" cta="All" />
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

          {active.length > 0 && (
            <section className="space-y-2.5">
              <SectionHeader label="In progress" href="/tasks" cta="All tasks" />
              <div className="space-y-2">
                {active.slice(0, 5).map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
            </section>
          )}

          {active.length === 0 && runningThreads.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-muted/10 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                All quiet. Delegate a task and a worker will pick it up.
              </p>
              <Link
                href="/tasks"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <ListPlus className="h-4 w-4" />
                New task
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// Setup checklist — the calm, guided first-run (Linear/Vercel style)
// ============================================================================

function SetupChecklist({
  hasCredentials,
  hasRepo,
  hasPlugin,
}: {
  hasCredentials: boolean;
  hasRepo: boolean;
  hasPlugin: boolean;
}) {
  const steps = [
    {
      done: hasCredentials,
      icon: <KeyRound className="h-5 w-5" />,
      title: "Connect AI",
      desc: "Add an API key so AI can run tasks and power terminals.",
      href: "/settings/ai",
      cta: "Add key",
    },
    {
      done: hasRepo,
      icon: <FolderGit2 className="h-5 w-5" />,
      title: "Connect a repo",
      desc: "Bring in a GitHub repo — citshe analyzes it automatically.",
      href: "/repos",
      cta: "Connect",
    },
    {
      done: hasPlugin,
      icon: <Blocks className="h-5 w-5" />,
      title: "Plug in your stack",
      desc: "Cloudflare, Neon, Google Ads — see deploys & health. Optional.",
      href: "/plugins",
      cta: "Add plugin",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Set up this portal</h2>
        <span className="text-xs text-muted-foreground">
          {doneCount}/{steps.length}
        </span>
      </div>
      <div className="space-y-2">
        {steps.map((step) => (
          <div
            key={step.title}
            className={cn(
              "flex items-center gap-3.5 rounded-xl border px-4 py-3.5 transition-colors",
              step.done
                ? "border-border bg-muted/20"
                : "border-border bg-background/50",
            )}
          >
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                step.done
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "bg-primary/10 text-primary",
              )}
            >
              {step.done ? <Check className="h-5 w-5" /> : step.icon}
            </div>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-sm font-medium",
                  step.done && "text-muted-foreground line-through",
                )}
              >
                {step.title}
              </p>
              {!step.done && (
                <p className="truncate text-xs text-muted-foreground">
                  {step.desc}
                </p>
              )}
            </div>
            {!step.done && (
              <Link
                href={step.href}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                {step.cta}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ============================================================================
// Pieces
// ============================================================================

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
        <span className={cn("h-2 w-2 rounded-full", dot[status.headline.state])} />
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

function SectionHeader({
  label,
  href,
  cta,
}: {
  label: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {label}
      </h2>
      <Link
        href={href}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        {cta} →
      </Link>
    </div>
  );
}

function ActionCard({
  href,
  onClick,
  icon,
  title,
  accent,
}: {
  href?: string;
  onClick?: () => void;
  icon: React.ReactNode;
  title: string;
  accent: string;
}) {
  const inner = (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-background/50 px-2 py-4 text-center transition-colors hover:bg-muted/40 hover:border-primary/30 cursor-pointer">
      <span className={accent}>{icon}</span>
      <span className="text-sm font-medium">{title}</span>
    </div>
  );
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
