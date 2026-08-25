"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Terminal,
  Blocks,
  KeyRound,
  FolderGit2,
  ListTodo,
  ArrowRight,
  Check,
  Search,
  X,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getTaskStatus } from "@/lib/status-config";
import { useAuthContext } from "@/lib/auth";
import {
  useTasks,
  useAICredentials,
  useSessions,
  useRepositories,
  usePlugins,
  usePluginStatus,
} from "@/lib/api/hooks";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader as UiSectionHeader } from "@/components/ui/section-header";
import { pluginCatalog, getPluginDef } from "@/lib/plugin-catalog";
import type {
  Task,
  TaskStatus,
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
  // Poll tasks while any is actively working so the build hero updates live.
  const { data: tasks = [], isLoading: tasksLoading } = useTasks(undefined, {
    refetchInterval: (query) => {
      const list = (query.state.data ?? []) as Task[];
      const busy = list.some((t) =>
        ["QUEUED", "ANALYZING", "IN_PROGRESS"].includes(t.status),
      );
      return busy ? 5000 : false;
    },
  });
  const { data: sessions = [], isLoading: sessionsLoading } = useSessions();
  const { data: credentials = [] } = useAICredentials();
  const { data: repos = [], isLoading: reposLoading } = useRepositories();
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

  // The most recent "New project" build task — its buildSpec drives the hero
  // "your site is coming to life" card. Show it while building AND right after
  // it deploys (REVIEW/COMPLETED with a siteUrl) so the user sees the payoff.
  const buildTask = useMemo(() => {
    const builds = (tasks as Task[])
      .filter((t) => !!t.buildSpec)
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
    const latest = builds[0];
    if (!latest) return null;
    const done = ["COMPLETED", "REVIEW"].includes(latest.status);
    const failed = latest.status === "FAILED";
    const res =
      latest.result && typeof latest.result === "object"
        ? (latest.result as Record<string, unknown>)
        : {};
    const siteUrl = res.siteUrl as string | undefined;
    const deployError = res.deployError as string | undefined;
    // Keep showing a finished build only while it still matters (has a URL, a
    // deploy error to explain, or is the freshest thing going on). Hide old,
    // closed builds with nothing to show.
    if (done && !siteUrl && !deployError && latest.status === "COMPLETED")
      return null;
    return { task: latest, done, failed, siteUrl, deployError };
  }, [tasks]);

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
    <div className="w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6 space-y-6">
      {/* Header */}
      <header className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wider text-text-subtle">
          {greeting}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
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

      {buildTask && <BuildHero {...buildTask} repos={repos as RepoLite[]} />}

      {!isSetUp && !buildTask ? (
        <SetupChecklist
          hasCredentials={hasCredentials}
          hasRepo={hasRepo}
          hasPlugin={hasPlugin}
        />
      ) : !isSetUp ? null : (
        <>
          {/* Inline search — filters results live, right here */}
          <QuickSearch
            tasks={tasks as Task[]}
            repos={repos as Array<{ id: string; name: string }>}
            sessions={sessions as Array<{ id: string; name: string; status: string }>}
          />

          {/* Columns — Repos / Live terminals / Recent tasks (stack on mobile) */}
          <div className="grid gap-x-4 gap-y-5 md:grid-cols-3">
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
                      <span className="min-w-0 flex-1 truncate text-foreground">
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
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {s.name}
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0 text-xs font-medium text-muted-foreground">
                        {s.status === "CREATING" ? (
                          <>
                            <StatusDot state="creating" size={7} />
                            Starting
                          </>
                        ) : (
                          <>
                            <StatusDot state="running" size={7} />
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

        </>
      )}
    </div>
  );
}

/**
 * Inline search on Home — filters tasks/repos/terminals AS YOU TYPE and shows
 * results right here (not a modal). The ⌘K modal is the sidebar's search; this
 * is the dashboard's own live search.
 */
function QuickSearch({
  tasks,
  repos,
  sessions,
}: {
  tasks: Task[];
  repos: Array<{ id: string; name: string }>;
  sessions: Array<{ id: string; name: string; status: string }>;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();

  const results = useMemo(() => {
    if (!query) return null;
    const match = (s: string) => s.toLowerCase().includes(query);
    return {
      tasks: tasks.filter((t) => match(t.title)).slice(0, 5),
      repos: repos.filter((r) => match(r.name)).slice(0, 5),
      terminals: sessions.filter((s) => match(s.name)).slice(0, 5),
    };
  }, [query, tasks, repos, sessions]);

  const empty =
    results &&
    results.tasks.length === 0 &&
    results.repos.length === 0 &&
    results.terminals.length === 0;

  return (
    <div className="relative">
      <div className="group flex w-full items-center gap-3 rounded-md border border-border bg-surface-inset px-4 py-3 transition-linear focus-within:border-border-strong focus-within:ring-2 focus-within:ring-ring">
        <Search className="h-4 w-4 shrink-0 text-text-subtle" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQ("");
          }}
          placeholder="Search tasks, repos, terminals…"
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {q && (
          <button
            onClick={() => setQ("")}
            className="text-text-subtle transition-linear hover:text-foreground"
            aria-label="Clear"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {results && (
        <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-md border border-border bg-surface-card shadow-xl">
          {empty ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No matches for “{q}”.
            </p>
          ) : (
            <div className="max-h-[min(360px,50vh)] divide-y divide-border overflow-y-auto">
              <SearchGroup label="Tasks" show={results.tasks.length > 0}>
                {results.tasks.map((t) => (
                  <SearchRow
                    key={t.id}
                    icon={<ListTodo className="h-4 w-4" />}
                    label={t.title}
                    onClick={() => router.push(`/tasks/${t.id}`)}
                  />
                ))}
              </SearchGroup>
              <SearchGroup label="Repos" show={results.repos.length > 0}>
                {results.repos.map((r) => (
                  <SearchRow
                    key={r.id}
                    icon={<FolderGit2 className="h-4 w-4" />}
                    label={r.name}
                    onClick={() => router.push(`/repos`)}
                  />
                ))}
              </SearchGroup>
              <SearchGroup label="Terminals" show={results.terminals.length > 0}>
                {results.terminals.map((s) => (
                  <SearchRow
                    key={s.id}
                    icon={<Terminal className="h-4 w-4" />}
                    label={s.name}
                    onClick={() => router.push(`/sessions/${s.id}`)}
                  />
                ))}
              </SearchGroup>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SearchGroup({
  label,
  show,
  children,
}: {
  label: string;
  show: boolean;
  children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <div className="py-1.5">
      <p className="px-4 py-1 text-[11px] font-medium uppercase tracking-wide text-text-subtle">
        {label}
      </p>
      {children}
    </div>
  );
}

function SearchRow({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-foreground transition-linear hover:bg-surface-hover focus-visible:outline-none focus-visible:bg-surface-hover"
    >
      <span className="shrink-0 text-text-subtle">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Small muted placeholder row for empty columns. */
function EmptyCell({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface-inset/40 px-3.5 py-4 text-left text-xs text-text-subtle">
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
// Build hero — "your project is coming to life" (post-wizard payoff)
// ============================================================================

type RepoLite = { id: string; name: string; webUrl?: string };

function BuildHero({
  task,
  failed,
  siteUrl,
  deployError,
  repos,
}: {
  task: Task;
  done: boolean;
  failed: boolean;
  siteUrl?: string;
  deployError?: string;
  repos: RepoLite[];
}) {
  const spec = (task.buildSpec ?? {}) as {
    mode?: string;
    repoFullPath?: string;
    repositoryId?: string;
  };
  const repo =
    repos.find((r) => r.id === spec.repositoryId) ??
    repos.find((r) => r.name && spec.repoFullPath?.endsWith(r.name));
  const repoUrl =
    repo?.webUrl ||
    (spec.repoFullPath ? `https://github.com/${spec.repoFullPath}` : undefined);

  // Latest worker milestone (a citshe-note) — shown live while building so the
  // user sees real progress ("Scaffolding Astro…", "Deploying…") not a spinner.
  const latestNote = (() => {
    const logs = Array.isArray(task.agentLogs) ? task.agentLogs : [];
    for (let i = logs.length - 1; i >= 0; i--) {
      const e = logs[i] as { action?: string; details?: { text?: string } };
      if (e?.action === "note" && e.details?.text) return e.details.text;
    }
    return null;
  })();

  // States: building, deployed (has URL), built-but-not-deployed, failed.
  const state = failed
    ? "failed"
    : siteUrl
      ? "live"
      : deployError
        ? "nodeploy"
        : "building";
  const title =
    state === "live"
      ? "Site is live"
      : state === "failed"
        ? "Build failed"
        : state === "nodeploy"
          ? "Built — not deployed"
          : spec.mode === "refresh"
            ? "Refreshing your site"
          : "Building your project";
  const dotState =
    state === "live"
      ? "ok"
      : state === "failed"
        ? "failed"
        : state === "nodeploy"
          ? "warn"
          : "running";

  const host = siteUrl?.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return (
    <section className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface-card px-4 py-3">
      <StatusDot state={dotState} size={8} pulse={state === "building"} />
      <span className="text-sm font-medium text-foreground">{title}</span>

      {host ? (
        <a
          href={siteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate text-sm text-muted-foreground transition-linear hover:text-foreground"
        >
          {host}
        </a>
      ) : state === "nodeploy" && deployError ? (
        <span className="truncate text-sm text-warn">{deployError}</span>
      ) : state === "building" ? (
        // Show the live worker note once it arrives; until then reassure rather
        // than showing an opaque repo slug (or nothing) beside the pulse.
        <span className="truncate text-sm text-muted-foreground">
          {latestNote ?? "Setting things up — this takes a few minutes…"}
        </span>
      ) : (
        repoUrl && (
          <span className="truncate text-sm text-muted-foreground">
            {repo?.name ?? spec.repoFullPath}
          </span>
        )
      )}

      <div className="ml-auto flex items-center gap-2">
        {siteUrl && (
          <a href={siteUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="primary" size="sm">
              <Globe className="size-3.5" />
              Open site
            </Button>
          </a>
        )}
        <Link
          href={`/tasks/${task.id}`}
          className="text-sm font-medium text-muted-foreground transition-linear hover:text-foreground"
        >
          {state === "building" ? "Watch →" : "Task →"}
        </Link>
      </div>
    </section>
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
              <Button asChild size="sm" className="shrink-0">
                <Link href={step.href}>
                  {step.cta}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
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
      className="group flex min-w-0 flex-col gap-3 overflow-hidden rounded-md border border-border bg-surface-card px-4 py-3.5 transition-linear hover:border-border-strong hover:bg-surface-hover"
    >
      <div className="flex items-center gap-2.5">
        <span className="shrink-0 text-muted-foreground">{def.icon}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {def.name}
        </span>
        <span
          className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground"
          title={STATUS_LABELS[state]}
        >
          <StatusDot state={state as StatusDotHealth} size={8} className="shrink-0" />
          <span className="truncate">{status?.headline.label ?? "Idle"}</span>
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        {status ? (
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            {status.metrics
              .slice(0, 2)
              .map((m) => `${m.value} ${m.label.toLowerCase()}`)
              .join(" · ") || def.tagline}
          </p>
        ) : (
          <Skeleton className="h-4 w-24" />
        )}
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
    <UiSectionHeader
      label={label}
      count={count}
      actionHref={href}
      actionLabel={cta}
    />
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
      <span className="min-w-0 flex-1 truncate text-foreground">{task.title}</span>
      {stuck && (
        <span
          title="No worker picked this up. Is the executor image built? Run `just executor-build`."
          className="flex items-center gap-1.5 shrink-0 text-xs font-medium text-muted-foreground"
        >
          <StatusDot state="warn" size={7} />
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
