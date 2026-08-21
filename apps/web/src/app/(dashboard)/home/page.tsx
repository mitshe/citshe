"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Loader2,
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
  AlertTriangle,
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
import { OPEN_COMMAND_EVENT } from "@/components/command-palette";
import { pluginCatalog, getPluginDef } from "@/lib/plugin-catalog";
import { useQuickLaunch } from "@/lib/hooks/use-quick-launch";
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

  // A portal is "set up" once it has a repo — the engine is Claude Code
  // (subscription), and the panel AI key + stack tools are optional. Before
  // that, show a calm guided checklist instead of scattered "connect X" boxes.
  const isSetUp = hasRepo;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-10 space-y-8">
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

          {/* Columns — Repos / Live terminals / Recent tasks (stack on mobile) */}
          <div className="grid gap-5 md:grid-cols-3">
            {/* Repos */}
            <section className="space-y-2.5">
              <SectionHeader label="Repos" href="/repos" cta="All" />
              <div className="space-y-2">
                {repos.slice(0, 5).map((repo) => (
                  <Link
                    key={repo.id}
                    href="/repos"
                    className="flex items-center gap-3 rounded-xl border border-border bg-background/50 px-3.5 py-3 hover:bg-muted/40"
                  >
                    <FolderGit2 className="h-4 w-4 shrink-0 text-violet-500" />
                    <span className="flex-1 truncate text-sm">{repo.name}</span>
                  </Link>
                ))}
                {repos.length === 0 && <EmptyCell label="No repos yet" />}
              </div>
            </section>

            {/* Live terminals */}
            <section className="space-y-2.5">
              <SectionHeader
                label="Live terminals"
                href="/sessions"
                cta="All"
              />
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
                      {s.status === "CREATING" ? (
                        <>
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Starting
                        </>
                      ) : (
                        <>
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Live
                        </>
                      )}
                    </span>
                  </Link>
                ))}
                {runningThreads.length === 0 && (
                  <EmptyCell label="No live terminals" />
                )}
              </div>
            </section>

            {/* Recent tasks */}
            <section className="space-y-2.5">
              <SectionHeader label="Recent tasks" href="/tasks" cta="All" />
              <div className="space-y-2">
                {active.slice(0, 5).map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
                {active.length === 0 && <EmptyCell label="No active tasks" />}
              </div>
            </section>
          </div>

          {/* Stack — compact shortcuts; full view lives on each tool's page */}
          {hasPlugin && (
            <section className="space-y-2.5">
              <SectionHeader label="Stack" href="/stack" cta="Manage" />
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
      onClick={() =>
        window.dispatchEvent(new Event(OPEN_COMMAND_EVENT))
      }
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-background/50 px-4 py-3 text-left transition-colors hover:bg-muted/40 hover:border-primary/30"
    >
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-sm text-muted-foreground">
        Search tasks, repos, terminals…
      </span>
      <kbd className="hidden shrink-0 items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline-flex">
        ⌘K
      </kbd>
    </button>
  );
}

/** Small muted placeholder row for empty columns. */
function EmptyCell({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/10 px-3.5 py-3 text-center text-xs text-muted-foreground">
      {label}
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

/** Compact stack shortcut — health + top metrics, links to the tool's page. */
function StackTile({ type }: { type: PluginType }) {
  const def = getPluginDef(type);
  const { data: status } = usePluginStatus(type);
  if (!def) return null;

  const dot: Record<HealthState, string> = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    down: "bg-red-500",
    idle: "bg-muted-foreground/50",
  };
  const state = status?.headline.state ?? "idle";

  return (
    <Link
      href={`/stack/${type.toLowerCase()}`}
      className="flex items-center gap-3 rounded-xl border border-border bg-background/50 px-3.5 py-3 transition-colors hover:bg-muted/40"
    >
      <span className={def.accent}>{def.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{def.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {status
            ? status.metrics
                .slice(0, 2)
                .map((m) => `${m.value}`)
                .join(" · ") || status.headline.label
            : "…"}
        </p>
      </div>
      <span className="flex items-center gap-1.5 shrink-0 text-[11px] font-medium text-muted-foreground">
        <span className={cn("h-1.5 w-1.5 rounded-full", dot[state])} />
        {status?.headline.label ?? "—"}
      </span>
    </Link>
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
      className="flex items-center gap-3 rounded-xl border border-border bg-background/50 px-3.5 py-3 hover:bg-muted/40"
    >
      <span className={cn("shrink-0", textColor)}>{meta.icon}</span>
      <span className="flex-1 truncate text-sm">{task.title}</span>
      {stuck && (
        <span
          title="No worker picked this up. Is the executor image built? Run `just executor-build`."
          className="flex items-center gap-1 shrink-0 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600"
        >
          <AlertTriangle className="h-3 w-3" />
          Stuck — executor?
        </span>
      )}
      {liveWorker && (
        <span className="flex items-center gap-1 shrink-0 text-[11px] font-medium text-emerald-500">
          <Terminal className="h-3.5 w-3.5" />
          Watch
        </span>
      )}
      <span className={cn("shrink-0 text-[11px] font-medium", textColor)}>
        {meta.label}
      </span>
    </Link>
  );
}
