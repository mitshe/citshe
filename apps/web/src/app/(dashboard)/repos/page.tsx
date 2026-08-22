"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusDot } from "@/components/ui/status-dot";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatusDotState } from "@/components/ui/status-dot";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FolderGit2,
  Loader2,
  Plus,
  Sparkles,
  Terminal,
  GitBranch,
  Check,
  RefreshCw,
  RotateCw,
  Github,
  Rocket,
  Trash2,
  Search,
  MoreVertical,
  Power,
  PowerOff,
} from "lucide-react";
import {
  useRepositories,
  useRemoteRepositories,
  useSyncSelectiveRepositories,
  useAnalyzeRepo,
  useDeleteRepository,
  useSyncOneRepository,
  useUpdateRepository,
  useIntegrations,
  useGithubAppStart,
  usePreviews,
} from "@/lib/api/hooks";
import { useQuickLaunch } from "@/lib/hooks/use-quick-launch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Repository, RepoAnalysisStatus } from "@/lib/api/types";

type RepoFilter = "all" | "analyzed" | "pending";

/** Map a repo's analysis status to a StatusDot state. */
function analysisDot(status: RepoAnalysisStatus | null | undefined): {
  state: StatusDotState;
  label: string;
} {
  switch (status) {
    case "analyzing":
      return { state: "creating", label: "Analyzing" };
    case "done":
      return { state: "ok", label: "Analyzed" };
    case "failed":
      return { state: "failed", label: "Analysis failed" };
    default:
      return { state: "idle", label: "Not analyzed" };
  }
}

export default function ReposPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: repos = [], isLoading } = useRepositories();
  const { data: integrations = [] } = useIntegrations();
  const githubAppStart = useGithubAppStart();
  const [connectOpen, setConnectOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<RepoFilter>("all");

  const hasGitIntegration = integrations.some(
    (i) => i.type === "GITHUB" && i.status === "CONNECTED",
  );

  // Handle the return from the GitHub App install redirect.
  const connected = searchParams.get("connected");
  useEffect(() => {
    if (connected === "github") {
      toast.success("GitHub connected");
      router.replace("/repos");
    } else if (connected === "error") {
      toast.error("GitHub connection failed — try again");
      router.replace("/repos");
    }
  }, [connected, router]);

  const startGithubSso = async () => {
    try {
      const { url } = await githubAppStart.mutateAsync();
      window.location.href = url;
    } catch {
      // App not configured → send them to Settings for the token fallback.
      router.push("/settings/integrations");
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return repos.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !r.fullPath.toLowerCase().includes(q))
        return false;
      if (filter === "analyzed") return r.analysisStatus === "done";
      if (filter === "pending") return r.analysisStatus !== "done";
      return true;
    });
  }, [repos, search, filter]);

  return (
    <div className="w-full max-w-[1400px] space-y-5 px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Repos</h1>
          <p className="text-sm text-muted-foreground">
            The repositories in this portal. Connect one and AI analyzes it.
          </p>
        </div>
        {hasGitIntegration ? (
          <Button size="sm" onClick={() => setConnectOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Connect repo
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={startGithubSso}
            disabled={githubAppStart.isPending}
          >
            {githubAppStart.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Github className="mr-1.5 h-4 w-4" />
            )}
            Connect GitHub
          </Button>
        )}
      </div>

      {!hasGitIntegration && (
        <div className="rounded-md border border-dashed border-border bg-surface-inset/40 p-4 text-sm">
          <p className="text-muted-foreground">
            Connect GitHub to pull in your repositories — authorize once, then
            pick repos.{" "}
            <Link
              href="/settings/integrations"
              className="font-medium text-foreground underline"
            >
              Use a token instead
            </Link>
          </p>
        </div>
      )}

      {/* Search + filter */}
      {(repos.length > 0 || search) && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle" />
            <Input
              placeholder="Search repos…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-8"
            />
          </div>
          <SegmentedControl
            value={filter}
            onChange={setFilter}
            aria-label="Filter repos"
            options={[
              { value: "all", label: "All" },
              { value: "analyzed", label: "Analyzed" },
              { value: "pending", label: "Pending" },
            ]}
          />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-md border border-border bg-surface-card p-4"
            >
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-4 rounded-full" />
                <Skeleton className="h-4 w-40" />
              </div>
              <Skeleton className="mt-3 h-3 w-3/5" />
            </div>
          ))}
        </div>
      ) : repos.length === 0 ? (
        <EmptyState
          icon={<FolderGit2 />}
          title="No repos connected yet"
          description="Connect a repository and citshe analyzes its stack, CI and structure automatically."
          action={
            hasGitIntegration ? (
              <Button size="sm" onClick={() => setConnectOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Connect a repo
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={startGithubSso}
                disabled={githubAppStart.isPending}
              >
                <Github className="mr-1.5 h-4 w-4" />
                Connect GitHub
              </Button>
            )
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search />}
          title="No matching repos"
          description="Try a different search or filter."
        />
      ) : (
        <div className="space-y-2.5">
          {filtered.map((repo) => (
            <RepoCard key={repo.id} repo={repo} />
          ))}
        </div>
      )}

      <ConnectRepoDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </div>
  );
}

function RepoCard({ repo }: { repo: Repository }) {
  const analyze = useAnalyzeRepo();
  const deleteRepo = useDeleteRepository();
  const syncOne = useSyncOneRepository();
  const updateRepo = useUpdateRepository();
  const quickLaunch = useQuickLaunch();
  const analyzing = repo.analysisStatus === "analyzing" || analyze.isPending;
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const dot = analysisDot(analyzing ? "analyzing" : repo.analysisStatus);

  const runAnalysis = async () => {
    try {
      await analyze.mutateAsync(repo.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Analysis failed");
    }
  };

  // Sync = refresh metadata from the remote (distinct from AI analysis).
  const runSync = async () => {
    try {
      await syncOne.mutateAsync(repo.id);
      toast.success("Synced from remote");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    }
  };

  // isActive gates orchestration (getAvailableRepositories filters isActive).
  const toggleActive = async () => {
    try {
      await updateRepo.mutateAsync({
        id: repo.id,
        data: { isActive: !repo.isActive },
      });
      toast.success(repo.isActive ? "Repo disabled" : "Repo enabled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update repo");
    }
  };

  const disconnect = async () => {
    try {
      await deleteRepo.mutateAsync(repo.id);
      toast.success("Removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove repo");
    }
  };

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-surface-card p-4 transition-linear hover:bg-surface-hover hover:border-border-strong",
        !repo.isActive && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FolderGit2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{repo.name}</span>
            {repo.fullPath.includes("/") && (
              <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {repo.fullPath.split("/")[0]}
              </span>
            )}
            {!repo.isActive && (
              <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                Disabled
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
            <span
              className="inline-flex items-center gap-1.5 shrink-0"
              title={dot.label}
            >
              <StatusDot state={dot.state} size={7} />
              {dot.label}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1 text-text-subtle">
              <GitBranch className="h-3 w-3 shrink-0" />
              <span className="truncate">{repo.defaultBranch}</span>
            </span>
            <a
              href={repo.webUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-text-subtle hover:text-foreground hover:underline"
            >
              <Github className="h-3 w-3" />
              {repo.provider === "GITHUB" ? "GitHub" : repo.provider}
            </a>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-9 px-2.5"
            onClick={() => quickLaunch.launch({ repositoryId: repo.id })}
            disabled={quickLaunch.launching}
            title="Open a terminal on this repo"
            aria-label="Open a terminal on this repo"
          >
            <Terminal className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-9 px-2.5"
            onClick={runAnalysis}
            disabled={analyzing}
            title="Re-analyze this repo"
            aria-label="Re-analyze this repo"
          >
            {analyzing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-9 px-2.5"
                title="More actions"
                aria-label="More actions"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => void runSync()}
                disabled={syncOne.isPending}
              >
                <RotateCw className="mr-2 h-3.5 w-3.5" />
                Sync from remote
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => void toggleActive()}
                disabled={updateRepo.isPending}
              >
                {repo.isActive ? (
                  <>
                    <PowerOff className="mr-2 h-3.5 w-3.5" />
                    Disable
                  </>
                ) : (
                  <>
                    <Power className="mr-2 h-3.5 w-3.5" />
                    Enable
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setDisconnectOpen(true)}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Disconnect
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect repo?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {repo.name} from this portal? This does not delete it on
              GitHub — tasks and terminals keep working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={disconnect}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Analysis */}
      <div className="mt-3 space-y-2">
        {analyzing ? (
          <p className="flex items-center gap-1.5 text-xs text-warn">
            <Sparkles className="h-3.5 w-3.5" />
            Analyzing project…
          </p>
        ) : repo.analysisStatus === "done" ? (
          <>
            {repo.summary && (
              <p className="text-sm text-muted-foreground">{repo.summary}</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {repo.stack?.framework && <Chip>{repo.stack.framework}</Chip>}
              {repo.stack?.language && !repo.stack.framework && (
                <Chip>{repo.stack.language}</Chip>
              )}
              {repo.stack?.packageManager && (
                <Chip>{repo.stack.packageManager}</Chip>
              )}
              {repo.ciSummary && repo.ciSummary.provider !== "none" && (
                <Chip>
                  <GitBranch className="mr-1 inline h-3 w-3" />
                  {repo.ciSummary.provider === "github-actions"
                    ? `CI: ${repo.ciSummary.workflows?.length ?? 0} workflow(s)`
                    : "CI: GitLab"}
                </Chip>
              )}
            </div>
          </>
        ) : repo.analysisStatus === "failed" ? (
          <p className="text-xs text-danger">
            Analysis failed.{" "}
            <button onClick={runAnalysis} className="underline">
              Retry
            </button>
          </p>
        ) : (
          <button
            onClick={runAnalysis}
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-linear hover:text-foreground"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Analyze project
          </button>
        )}
      </div>

      <RepoPreviews repoName={repo.name} />
    </div>
  );
}

/** Clickable preview deployments for this repo — test on a real deploy. */
function RepoPreviews({ repoName }: { repoName: string }) {
  const { data: previews = [] } = usePreviews(repoName);
  if (previews.length === 0) return null;

  const dotState: Record<string, StatusDotState> = {
    ok: "ok",
    warn: "warn",
    down: "down",
    idle: "idle",
  };

  return (
    <div className="mt-3 space-y-1.5 border-t border-border pt-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-subtle">
        <Rocket className="h-3 w-3" />
        Previews
      </p>
      {previews.slice(0, 4).map((p, i) => (
        <a
          key={i}
          href={p.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-xs transition-linear hover:underline"
        >
          <StatusDot state={dotState[p.state] ?? "idle"} size={7} />
          <span className="min-w-0 flex-1 truncate text-foreground">
            {p.branch || p.url.replace(/^https?:\/\//, "")}
          </span>
          {p.commit && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {p.commit}
            </span>
          )}
        </a>
      ))}
    </div>
  );
}

// ============================================================================
// Connect repo dialog — pick from the user's remote repos.
// ============================================================================

function ConnectRepoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const remote = useRemoteRepositories();
  const sync = useSyncSelectiveRepositories();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remoteMutate = remote.mutateAsync;

  const load = useCallback(async () => {
    setError(null);
    try {
      await remoteMutate();
      setLoaded(true);
    } catch (err) {
      // Surface the reason in the dialog (not just a toast that vanishes) —
      // most often "no GitHub connected yet".
      setError(err instanceof Error ? err.message : "Failed to load repos");
      setLoaded(true);
    }
  }, [remoteMutate]);

  // Fetch the repo list when the dialog opens. A controlled Radix dialog only
  // fires onOpenChange on internal interactions, NOT when `open` flips from a
  // parent prop — so triggering the load there never ran. Do it on `open`.
  useEffect(() => {
    if (open && !loaded) void load();
  }, [open, loaded, load]);

  const list = (remote.data ?? []).filter(
    (r) =>
      !r.alreadyImported &&
      (r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.fullPath.toLowerCase().includes(search.toLowerCase())),
  );

  const toggle = (externalId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });
  };

  const connect = async () => {
    // Group selected repos by their integration, sync each group.
    const byIntegration = new Map<string, string[]>();
    for (const r of remote.data ?? []) {
      if (!selected.has(r.externalId)) continue;
      const arr = byIntegration.get(r.integrationId) ?? [];
      arr.push(r.externalId);
      byIntegration.set(r.integrationId, arr);
    }
    try {
      for (const [integrationId, externalIds] of byIntegration) {
        await sync.mutateAsync({ integrationId, externalIds });
      }
      toast.success("Repo(s) connected — analyzing in the background");
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect");
    }
  };

  const reset = () => {
    setSearch("");
    setSelected(new Set());
    setLoaded(false);
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect a repository</DialogTitle>
        </DialogHeader>
        <DialogBody className="mr-0 w-full min-w-0 space-y-3 pr-0">
          <Input
            placeholder="Search your repos…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {remote.isPending ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="space-y-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Couldn&apos;t load your repositories. Connect GitHub first.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/settings/integrations">Connect GitHub</Link>
              </Button>
            </div>
          ) : loaded && (remote.data ?? []).length === 0 ? (
            <div className="space-y-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No repositories found. Connect GitHub to see your repos here.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/settings/integrations">Connect GitHub</Link>
              </Button>
            </div>
          ) : list.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {loaded ? "No repositories match your search." : "Loading…"}
            </p>
          ) : (
            <div className="-mr-2 max-h-72 w-full min-w-0 space-y-1 overflow-y-auto overflow-x-hidden pr-2">
              {list.map((r) => (
                <button
                  key={`${r.integrationId}-${r.externalId}`}
                  onClick={() => toggle(r.externalId)}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-linear",
                    selected.has(r.externalId)
                      ? "border-primary/50 bg-primary/10 ring-1 ring-primary/40"
                      : "border-border hover:bg-surface-hover",
                  )}
                >
                  <Github className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p className="truncate font-medium">{r.name}</p>
                      {r.fullPath.includes("/") && (
                        <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {r.fullPath.split("/")[0]}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.fullPath}
                    </p>
                  </div>
                  {selected.has(r.externalId) && (
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                  )}
                </button>
              ))}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={connect}
            disabled={selected.size === 0 || sync.isPending}
          >
            {sync.isPending && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            )}
            Connect {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
