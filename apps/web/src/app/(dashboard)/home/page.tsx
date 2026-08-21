"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Terminal,
  Pause,
  Play,
  Cpu,
  Blocks,
  KeyRound,
  FolderGit2,
  ArrowRight,
  Check,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getTaskStatus } from "@/lib/status-config";
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
import { OPEN_COMMAND_EVENT } from "@/components/shell/command-palette";
import { StatusDot } from "@/components/ui/status-dot";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { pluginCatalog, getPluginDef } from "@/lib/plugin-catalog";
import type {
  Task,
  TaskStatus,
  QueueOverview,
  HealthState,
  PluginType,
} from "@citshe/types";

const ACTIVE_STATUSES: TaskStatus[] = ["PENDING", "QUEUED", "ANALYZING", "IN_PROGRESS", "REVIEW"];
const LIVE_WORKER_STATUSES: TaskStatus[] = ["ANALYZING", "IN_PROGRESS"];

// A task that should be moving but isn't: a worker status with no live session,
// untouched for a while. Usually means nothing picked it up (e.g. the executor
// image isn't built).
const STUCK_STATUSES: TaskStatus[] = ["QUEUED", "ANALYZING", "IN_PROGRESS"];
const STUCK_AFTER_MS = 5 * 60 * 1000;

/** HealthState (ok/warn/down/idle) is a 1:1 subset of StatusDot's states. */
type StatusDotHealth = "ok" | "warn" | "down" | "idle";

/** No worker picked this up and it's gone quiet — likely the executor. */
function isStuck(task: Task): boolean {
  return (
    STUCK_STATUSES.includes(task.status) &&
    !task.sessionId &&
    Date.now() - new Date(task.updatedAt).getTime() > STUCK_AFTER_MS
  );
}

export default function HomePage() {
  const { currentOrg } = useAuthContext();
  const { data: tasks = [], isLoading: tasksLoading } = useTasks();
  const { data: sessions = [], isLoading: sessionsLoading } = useSessions();
  const { data: credentials = [] } = useAICredentials();
  const { data: repos = [], isLoading: reposLoading } = useRepositories();
  const { data: queue } = useQueueOverview();
  const { data: plugins = [] } = usePlugins();

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

  // A portal is "set up" once it has a repo — the engine is Claude Code
  // (subscription), and the panel AI key + stack tools are optional. Before
  // that, show a calm guided checklist instead of scattered "connect X" boxes.
  const isSetUp = hasRepo;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-10 space-y-10">
      {/* Portal selector — mobile only; desktop has it in the sidebar */}
      <div className="sm:hidden">
        <OrgSwitcher />
      </div>

      {/* Header */}
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-text-subtle">
          {greeting}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {currentOrg?.name ?? "Your portal"}
        </h1>
        {isSetUp && connectedTypes.has("CLOUDFLARE") ? (
          <StatusLine />
        ) : isSetUp ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <StatusDot state="idle" size={8} />
            {repos.length} repo{repos.length === 1 ? "" : "s"} connected
            {" · not deployed"}
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
          {/* Quick-search — opens the global ⌘K command palette */}
          <QuickSearch />

          {/* Columns — Repos / Live terminals / Recent tasks (stack on mobile) */}
          <div className="grid gap-6 md:grid-cols-3">
            {/* Repos */}
            <section className="space-y-3">
              <SectionHeader
                label="Repos"
                href="/repos"
                cta="All"
                count={repos.length}
              />
              <div className="space-y-2">
                {reposLoading ? (
                  <RowSkeletons />
                ) : repos.length === 0 ? (
                  <EmptyCell label="No repos yet" />
                ) : (
                  repos.slice(0, 5).map((repo) => (
                    <Link
                      key={repo.id}
                      href="/repos"
                      className="flex items-center gap-3 rounded-md border border-border bg-surface-card px-4 py-3.5 transition-linear hover:border-border-strong hover:bg-surface-hover"
                    >
                      <FolderGit2 className="h-4 w-4 shrink-0 text-primary" />
                      <span className="flex-1 truncate text-foreground">
                        {repo.name}
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </section>

            {/* Live terminals */}
            <section className="space-y-3">
              <SectionHeader
                label="Live terminals"
                href="/sessions"
                cta="All"
                count={runningThreads.length}
              />
              <div className="space-y-2">
                {sessionsLoading ? (
                  <RowSkeletons />
                ) : runningThreads.length === 0 ? (
                  <EmptyCell label="No live terminals" />
                ) : (
                  runningThreads.map((s) => (
                    <Link
                      key={s.id}
                      href={`/sessions/${s.id}`}
                      className="flex items-center gap-3 rounded-md border border-border bg-surface-card px-4 py-3.5 transition-linear hover:border-border-strong hover:bg-surface-hover"
                    >
                      <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate text-foreground">
                        {s.name}
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0 text-xs font-medium text-muted-foreground">
                        {s.status === "CREATING" ? (
                          <>
                            <StatusDot state="creating" size={8} />
                            Starting
                          </>
                        ) : (
                          <>
                            <StatusDot state="running" size={8} />
                            Live
                          </>
                        )}
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </section>

            {/* Recent tasks */}
            <section className="space-y-3">
              <SectionHeader
                label="Recent tasks"
                href="/tasks"
                cta="All"
                count={active.length}
              />
              <div className="space-y-2">
                {tasksLoading ? (
                  <RowSkeletons />
                ) : active.length === 0 ? (
                  <EmptyCell label="No active tasks" />
                ) : (
                  active.slice(0, 5).map((t) => <TaskRow key={t.id} task={t} />)
                )}
              </div>
            </section>
          </div>

          {/* Stack — connected plugins; full view lives on each tool's page */}
          {hasPlugin && (
            <section className="space-y-3">
              <SectionHeader
                label="Stack"
                href="/stack"
                cta="Manage"
                count={connectedTypes.size}
              />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pluginCatalog
                  .filter((def) => connectedTypes.has(def.type))
                  .map((def) => (
                    <StackTile key={def.type} type={def.type} />
                  ))}
              </div>
            </section>
          )}
          {!hasPlugin && (
            <Link
              href="/stack"
              className="group flex items-center gap-3 rounded-md border border-dashed border-border bg-surface-inset/40 px-4 py-3.5 transition-linear hover:border-primary/50 hover:bg-surface-hover"
            >
              <Blocks className="h-5 w-5 text-info" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  Connect your stack
                </p>
                <p className="text-xs text-muted-foreground">
                  Cloudflare, Neon, Google Ads — see deploys & health here
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground transition-linear group-hover:translate-x-0.5 group-hover:text-foreground" />
            </Link>
          )}

          {/* Workers strip (queue) */}
          {queue && <WorkersStrip queue={queue} />}
        </>
      )}
    </div>
  );
}

/** Cloudflare-style full-width search field — a button that opens the ⌘K palette. */
function QuickSearch() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_EVENT))}
      className="group flex w-full items-center gap-3 rounded-md border border-border bg-surface-inset px-4 py-3 text-left transition-linear hover:border-border-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Search className="h-4 w-4 shrink-0 text-text-subtle transition-linear group-hover:text-muted-foreground" />
      <span className="flex-1 text-sm text-muted-foreground">
        Search tasks, repos, terminals…
      </span>
      <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
    </button>
  );
}

/** Small muted placeholder row for empty columns. */
function EmptyCell({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface-inset/40 px-3.5 py-4 text-center text-xs text-text-subtle">
      {label}
    </div>
  );
}

/** Skeleton rows matching the column list item height. */
function RowSkeletons({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-md border border-border bg-surface-card px-4 py-3.5"
        >
          <Skeleton className="h-4 w-4 rounded-sm" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </>
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
      desc: "Cloudflare, Neon, Vercel — see deploys & health. Optional.",
      href: "/stack",
      cta: "Add tool",
    },
    {
      done: hasCredentials,
      icon: <KeyRound className="h-5 w-5" />,
      title: "Panel AI",
      desc: "Connect OpenRouter or Claude API for in-panel helpers. Optional.",
      href: "/settings/ai",
      cta: "Connect",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">
          Set up this portal
        </h2>
        <span className="text-xs font-medium text-text-subtle">
          {doneCount}/{steps.length}
        </span>
      </div>
      <div className="space-y-2">
        {steps.map((step) => (
          <div
            key={step.title}
            className={cn(
              "flex items-center gap-3.5 rounded-md border px-4 py-3.5 transition-linear",
              step.done
                ? "border-border bg-surface-inset/40"
                : "border-border bg-surface-card",
            )}
          >
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                step.done
                  ? "bg-ok/10 text-ok"
                  : "bg-primary/10 text-primary",
              )}
            >
              {step.done ? <Check className="h-5 w-5" /> : step.icon}
            </div>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-sm font-medium",
                  step.done
                    ? "text-text-subtle line-through"
                    : "text-foreground",
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
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-[0_0_0_1px_var(--accent-glow),0_0_16px_-4px_var(--accent-glow)] transition-linear hover:brightness-110"
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
        <StatusDot state="idle" size={8} />
        Checking deploy status…
      </p>
    );
  }
  if (!status) return null;

  const deploy = status.metrics.find((m) => m.label === "Last deploy");

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="flex items-center gap-1.5 font-medium text-foreground">
        <StatusDot state={status.headline.state as StatusDotHealth} size={8} />
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

/** Compact stack shortcut — health + top metrics, links to the tool's page. */
function StackTile({ type }: { type: PluginType }) {
  const def = getPluginDef(type);
  const { data: status } = usePluginStatus(type);
  if (!def) return null;

  const state: HealthState = status?.headline.state ?? "idle";

  return (
    <Link
      href={`/stack/${type.toLowerCase()}`}
      className="group flex flex-col gap-3 rounded-md border border-border bg-surface-card px-4 py-3.5 transition-linear hover:border-border-strong hover:bg-surface-hover"
    >
      <div className="flex items-center gap-2.5">
        <span className="text-muted-foreground">{def.icon}</span>
        <span className="flex-1 truncate font-medium text-foreground">
          {def.name}
        </span>
        <span
          className="flex items-center gap-1.5 shrink-0 text-xs font-medium text-muted-foreground"
          title={STATUS_LABELS[state]}
        >
          <StatusDot state={state as StatusDotHealth} size={8} />
          {status?.headline.label ?? "—"}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs text-muted-foreground">
          {status
            ? status.metrics
                .slice(0, 2)
                .map((m) => `${m.value} ${m.label.toLowerCase()}`)
                .join(" · ") || def.tagline
            : "…"}
        </p>
        <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground transition-linear group-hover:text-foreground">
          Manage
          <ArrowRight className="h-3.5 w-3.5 transition-linear group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

const STATUS_LABELS: Record<StatusDotHealth, string> = {
  ok: "Healthy",
  warn: "Warning",
  down: "Down",
  idle: "Idle",
};

function SectionHeader({
  label,
  href,
  cta,
  count,
}: {
  label: string;
  href: string;
  cta: string;
  count?: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-subtle">
        {label}
        {count != null && count > 0 && (
          <span className="rounded-sm bg-surface-hover px-1.5 py-0.5 text-[10px] tabular-nums normal-case tracking-normal text-muted-foreground">
            {count}
          </span>
        )}
      </h2>
      <Link
        href={href}
        className="text-xs text-muted-foreground transition-linear hover:text-foreground"
      >
        {cta} →
      </Link>
    </div>
  );
}

function WorkersStrip({ queue }: { queue: QueueOverview }) {
  const setPaused = useSetQueuePaused();
  const waiting = queue.pending.length + queue.queued.length;
  const active = queue.runningWorkers;

  if (active === 0 && waiting === 0 && !queue.queuePaused) return null;

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-surface-card px-3.5 py-2.5">
      <Cpu
        className={cn(
          "h-4 w-4 shrink-0",
          active > 0 ? "text-ok" : "text-text-subtle",
        )}
      />
      <div className="flex-1 text-sm">
        <span className="font-medium tabular-nums text-foreground">
          {active}/{queue.maxWorkers}
        </span>{" "}
        <span className="text-muted-foreground">
          worker{active === 1 ? "" : "s"} running
        </span>
        {waiting > 0 && (
          <span className="text-muted-foreground"> · {waiting} waiting</span>
        )}
        {queue.queuePaused && <span className="text-warn"> · paused</span>}
      </div>
      <button
        type="button"
        disabled={setPaused.isPending}
        onClick={() => setPaused.mutate(!queue.queuePaused)}
        className={cn(
          "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-linear disabled:opacity-50",
          queue.queuePaused
            ? "text-ok hover:bg-ok/10"
            : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
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

function TaskRow({ task }: { task: Task }) {
  // Shared source of truth for status icon/label/color — matches the board.
  const meta = getTaskStatus(task.status);
  const textColor = meta.color.split(" ")[1];
  const liveWorker =
    !!task.sessionId && LIVE_WORKER_STATUSES.includes(task.status);
  const stuck = isStuck(task);
  const href = liveWorker ? `/sessions/${task.sessionId}` : `/tasks/${task.id}`;
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-md border border-border bg-surface-card px-4 py-3.5 transition-linear hover:border-border-strong hover:bg-surface-hover"
    >
      <span className={cn("shrink-0", textColor)}>{meta.icon}</span>
      <span className="flex-1 truncate text-foreground">{task.title}</span>
      {stuck && (
        <span
          title="No worker picked this up. Is the executor image built? Run `just executor-build`."
          className="flex items-center gap-1.5 shrink-0 text-xs font-medium text-muted-foreground"
        >
          <StatusDot state="warn" size={8} />
          Stuck
        </span>
      )}
      {liveWorker && !stuck && (
        <span className="flex items-center gap-1 shrink-0 text-xs font-medium text-muted-foreground">
          <Terminal className="h-3.5 w-3.5" />
          Watch
        </span>
      )}
      <span className={cn("shrink-0 text-xs font-medium", textColor)}>
        {meta.label}
      </span>
    </Link>
  );
}
