"use client";

import { use, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Github,
  Play,
  ShieldCheck,
} from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";
import type { StatusDotState } from "@/components/ui/status-dot";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Eyebrow, SectionCount } from "@/components/ui/section-header";
import { useRepository, useRepositoryOverview } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";
import type {
  RepoCiStatus,
  RepoCommit,
  RepoPullRequest,
  RepoBranch,
  RepoWorkflowRun,
} from "@/lib/api/types";

/** Map a CI status to a StatusDot state + word. */
const CI_STATE: Record<
  RepoCiStatus,
  { dot: StatusDotState; label: string }
> = {
  passing: { dot: "ok", label: "Passing" },
  failing: { dot: "down", label: "Failing" },
  running: { dot: "creating", label: "Running" },
  unknown: { dot: "idle", label: "Unknown" },
};

export default function RepoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: repo, isLoading: repoLoading } = useRepository(id);
  const { data: overview, isLoading: overviewLoading } =
    useRepositoryOverview(id);

  const links = overview?.links;

  return (
    <div className="w-full max-w-[1400px] space-y-6 px-4 sm:px-6 py-6 sm:py-8">
      {/* Back */}
      <Link
        href="/repos"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-linear hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to repos
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-surface-card text-muted-foreground [&_svg]:h-5 [&_svg]:w-5">
            <Github />
          </span>
          <div className="min-w-0 space-y-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {repoLoading ? (
                <span className="inline-block h-7 w-48 animate-pulse rounded bg-surface-hover align-middle" />
              ) : (
                (repo?.name ?? "Repository")
              )}
            </h1>
            <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
              <span>{repo?.provider === "GITHUB" ? "GitHub" : repo?.provider ?? "GitHub"}</span>
              {repo?.defaultBranch && (
                <>
                  <span className="text-text-subtle">·</span>
                  <span className="inline-flex items-center gap-1">
                    <GitBranch className="h-3.5 w-3.5" />
                    <span className="font-mono text-xs">{repo.defaultBranch}</span>
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Quick links */}
      {links && (
        <div className="flex flex-wrap items-center gap-2">
          <QuickLink primary href={links.github} label="Open on GitHub" />
          <QuickLink href={links.actions} label="Actions" />
          <QuickLink href={links.pulls} label="Pull requests" />
          <QuickLink href={links.branches} label="Branches" />
          <QuickLink href={links.commits} label="Commits" />
        </div>
      )}

      {/* CI hero */}
      {overviewLoading ? (
        <HeroSkeleton />
      ) : (
        <CiHero ci={overview?.ci ?? null} />
      )}

      {/* Content: main + rail */}
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-6">
          {/* Recent commits */}
          <Block
            title="Recent commits"
            icon={<GitCommitHorizontal className="h-4 w-4" />}
            count={overview?.commits.length}
            viewAllHref={links?.commits}
          >
            {overviewLoading ? (
              <RowsSkeleton />
            ) : !overview?.commits.length ? (
              <BlockEmpty
                icon={<GitCommitHorizontal />}
                title="No recent commits"
                description="Commits will appear here once GitHub returns activity."
              />
            ) : (
              <CollapsibleList
                items={overview.commits}
                renderItem={(c) => <CommitRow key={c.sha} commit={c} />}
              />
            )}
          </Block>

          {/* Open pull requests */}
          <Block
            title="Open pull requests"
            icon={<GitPullRequest className="h-4 w-4" />}
            count={overview?.pulls.open}
            viewAllHref={links?.pulls}
          >
            {overviewLoading ? (
              <RowsSkeleton />
            ) : !overview?.pulls.items.length ? (
              <BlockEmpty
                icon={<GitPullRequest />}
                title="No open pull requests"
                description="Open PRs on this repo will show up here."
              />
            ) : (
              <CollapsibleList
                items={overview.pulls.items}
                renderItem={(p) => <PullRow key={p.number} pull={p} />}
              />
            )}
          </Block>

          {/* Branches */}
          <Block
            title="Branches"
            icon={<GitBranch className="h-4 w-4" />}
            count={overview?.branches.count}
            viewAllHref={links?.branches}
          >
            {overviewLoading ? (
              <RowsSkeleton />
            ) : !overview?.branches.items.length ? (
              <BlockEmpty
                icon={<GitBranch />}
                title="No branches"
                description="Branches will appear here once available."
              />
            ) : (
              <CollapsibleList
                items={overview.branches.items}
                renderItem={(b) => (
                  <BranchRow
                    key={b.name}
                    branch={b}
                    isDefault={b.name === repo?.defaultBranch}
                  />
                )}
              />
            )}
          </Block>
        </div>

        {/* Right rail — repo details */}
        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <RailBlock title="Details">
            <KV label="Provider" value={repo?.provider === "GITHUB" ? "GitHub" : repo?.provider ?? "—"} />
            <KV label="Default branch" value={repo?.defaultBranch ?? "—"} mono />
            <KV label="Path" value={repo?.fullPath ?? "—"} mono />
            {repo?.analysisStatus && (
              <KVStatus
                label="Analysis"
                {...analysisState(repo.analysisStatus)}
              />
            )}
            {repo?.stack?.framework && (
              <KV label="Framework" value={repo.stack.framework} />
            )}
            {repo?.stack?.language && (
              <KV label="Language" value={repo.stack.language} />
            )}
          </RailBlock>
        </aside>
      </div>
    </div>
  );
}

function analysisState(
  status: NonNullable<
    ReturnType<typeof useRepository>["data"]
  >["analysisStatus"],
): { value: string; state: StatusDotState } {
  switch (status) {
    case "analyzing":
      return { value: "Analyzing", state: "creating" };
    case "done":
      return { value: "Analyzed", state: "ok" };
    case "failed":
      return { value: "Failed", state: "failed" };
    default:
      return { value: "Not analyzed", state: "idle" };
  }
}

// ---- Quick link ------------------------------------------------------------

function QuickLink({
  href,
  label,
  primary,
}: {
  href: string;
  label: string;
  primary?: boolean;
}) {
  return (
    <Button variant="outline" size="sm" asChild className={cn(primary && "border-primary/50 text-primary hover:text-primary")}>
      <a href={href} target="_blank" rel="noreferrer">
        {label}
        <ArrowUpRight className="h-3.5 w-3.5" />
      </a>
    </Button>
  );
}

// ---- CI hero ---------------------------------------------------------------

function CiHero({
  ci,
}: {
  ci: {
    status: RepoCiStatus;
    run?: RepoWorkflowRun;
    recent: RepoWorkflowRun[];
  } | null;
}) {
  if (!ci) {
    return (
      <div className="rounded-lg border border-border bg-surface-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <Eyebrow>CI status</Eyebrow>
        </div>
        <div className="flex items-center gap-2.5 p-4">
          <StatusDot state="idle" size={10} />
          <div>
            <p className="text-sm font-medium text-foreground">
              CI status unavailable
            </p>
            <p className="text-xs text-text-subtle">
              This repo has no readable GitHub Actions, or the token can&apos;t
              access them.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { dot, label } = CI_STATE[ci.status];
  const run = ci.run;
  const meta = run
    ? ([
        run.name,
        run.branch,
        run.sha ? `#${run.sha.slice(0, 7)}` : undefined,
        run.when,
        run.event,
      ].filter(Boolean) as string[])
    : [];

  return (
    <div className="rounded-lg border border-border bg-surface-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-text-subtle">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <Eyebrow>CI status</Eyebrow>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2.5">
          <StatusDot state={dot} size={12} pulse={ci.status === "running"} />
          <span className="text-lg font-semibold text-foreground">{label}</span>
        </div>
        {run ? (
          <div className="space-y-1.5">
            <p className="font-mono text-xs text-text-subtle">
              {meta.join(" · ")}
            </p>
            <a
              href={run.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              View run
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </div>
        ) : (
          <p className="text-xs text-text-subtle">No workflow runs yet.</p>
        )}

        {ci.recent.length > 1 && (
          <div className="border-t border-border pt-3">
            <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-text-subtle">
              <Play className="h-3 w-3" />
              Recent runs
            </p>
            <div className="space-y-1">
              {ci.recent.slice(0, 5).map((r, i) => {
                const s = CI_STATE[r.status];
                return (
                  <a
                    key={`${r.sha}-${i}`}
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-linear hover:bg-surface-hover"
                  >
                    <StatusDot state={s.dot} size={7} />
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {r.name ?? "Workflow"}
                    </span>
                    <span className="shrink-0 font-mono text-text-subtle">
                      {r.branch ?? ""}
                    </span>
                    <span className="shrink-0 text-text-subtle">{r.when}</span>
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Rows ------------------------------------------------------------------

function CommitRow({ commit }: { commit: RepoCommit }) {
  return (
    <a
      href={commit.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-sm transition-linear last:border-b-0 hover:bg-surface-hover"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="shrink-0 font-mono text-xs text-text-subtle">
          {commit.sha.slice(0, 7)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-foreground">
            {commit.message}
          </span>
          <span className="mt-0.5 block truncate text-xs text-text-subtle">
            {commit.author} · {commit.when}
          </span>
        </span>
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-text-subtle" />
    </a>
  );
}

function PullRow({ pull }: { pull: RepoPullRequest }) {
  return (
    <a
      href={pull.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-sm transition-linear last:border-b-0 hover:bg-surface-hover"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="shrink-0 font-mono text-xs text-text-subtle">
          #{pull.number}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate text-foreground">{pull.title}</span>
            {pull.draft && (
              <span className="shrink-0 rounded-sm bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Draft
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-text-subtle">
            {pull.author} · <span className="font-mono">{pull.branch}</span>
          </span>
        </span>
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-text-subtle" />
    </a>
  );
}

function BranchRow({
  branch,
  isDefault,
}: {
  branch: RepoBranch;
  isDefault?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0">
      <span className="flex min-w-0 items-center gap-2.5">
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
        <span className="truncate font-mono text-foreground">
          {branch.name}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {isDefault && (
          <span className="rounded-sm bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Default
          </span>
        )}
        {branch.protected && (
          <span className="inline-flex items-center gap-1 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
            <ShieldCheck className="h-3 w-3" />
            Protected
          </span>
        )}
      </span>
    </div>
  );
}

// ---- Building blocks -------------------------------------------------------

const DEFAULT_VISIBLE = 5;

function Block({
  title,
  icon,
  count,
  viewAllHref,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  count?: number;
  viewAllHref?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          {icon && <span className="text-text-subtle">{icon}</span>}
          <Eyebrow>{title}</Eyebrow>
          {count != null && count > 0 && (
            <SectionCount className="normal-case tracking-normal">
              {count}
            </SectionCount>
          )}
        </div>
        {viewAllHref && (
          <a
            href={viewAllHref}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-muted-foreground transition-linear hover:text-foreground"
          >
            View all
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      {children}
    </section>
  );
}

function BlockEmpty({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="p-4">
      <EmptyState icon={icon} title={title} description={description} />
    </div>
  );
}

function CollapsibleList<T>({
  items,
  renderItem,
  initial = DEFAULT_VISIBLE,
}: {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  initial?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const hidden = items.length - initial;
  const visible = expanded ? items : items.slice(0, initial);

  return (
    <>
      {visible.map((item, i) => renderItem(item, i))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border px-4 py-2 text-xs font-medium text-muted-foreground transition-linear hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {expanded ? (
            <>
              Show less
              <ChevronDown className="h-3.5 w-3.5 rotate-180" />
            </>
          ) : (
            <>
              Show more ({hidden})
              <ChevronDown className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      )}
    </>
  );
}

// ---- Right rail ------------------------------------------------------------

function RailBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface-card">
      <div className="border-b border-border px-4 py-2.5">
        <Eyebrow>{title}</Eyebrow>
      </div>
      <dl>{children}</dl>
    </section>
  );
}

function KV({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-2 not-last:border-b not-last:border-border">
      <dt className="shrink-0 pt-px text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 break-words text-right text-sm font-medium text-foreground",
          mono && "font-mono text-xs",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function KVStatus({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state: StatusDotState;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 not-last:border-b not-last:border-border">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-1.5 text-right text-sm font-medium text-foreground">
        <StatusDot state={state} size={7} />
        {value}
      </dd>
    </div>
  );
}

// ---- Skeletons -------------------------------------------------------------

function HeroSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface-card">
      <div className="border-b border-border px-4 py-2.5">
        <div className="h-3 w-20 animate-pulse rounded bg-surface-hover" />
      </div>
      <div className="space-y-3 p-4">
        <div className="h-6 w-40 animate-pulse rounded bg-surface-hover" />
        <div className="h-3 w-56 animate-pulse rounded bg-surface-hover" />
      </div>
    </div>
  );
}

function RowsSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 last:border-b-0"
        >
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-surface-hover" />
          <div className="h-3 w-40 animate-pulse rounded bg-surface-hover" />
        </div>
      ))}
    </>
  );
}
