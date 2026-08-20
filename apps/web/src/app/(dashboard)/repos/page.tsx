"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FolderGit2,
  Loader2,
  Plus,
  Sparkles,
  Terminal,
  GitBranch,
  Check,
  RefreshCw,
  Github,
  Rocket,
} from "lucide-react";
import {
  useRepositories,
  useRemoteRepositories,
  useSyncSelectiveRepositories,
  useAnalyzeRepo,
  useIntegrations,
  useGithubAppStart,
  usePreviews,
} from "@/lib/api/hooks";
import { useQuickLaunch } from "@/lib/hooks/use-quick-launch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Repository } from "@/lib/api/types";

export default function ReposPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: repos = [], isLoading } = useRepositories();
  const { data: integrations = [] } = useIntegrations();
  const githubAppStart = useGithubAppStart();
  const [connectOpen, setConnectOpen] = useState(false);

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

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-8 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Repos</h1>
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
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm">
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

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : repos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center">
          <FolderGit2 className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">
            No repos connected yet.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {repos.map((repo) => (
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
  const quickLaunch = useQuickLaunch();
  const analyzing = repo.analysisStatus === "analyzing" || analyze.isPending;

  const runAnalysis = async () => {
    try {
      await analyze.mutateAsync(repo.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Analysis failed");
    }
  };

  return (
    <div className="rounded-xl border border-border bg-background/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FolderGit2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{repo.name}</span>
            {repo.fullPath.includes("/") && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {repo.fullPath.split("/")[0]}
              </span>
            )}
          </div>
          <a
            href={repo.webUrl}
            target="_blank"
            rel="noreferrer"
            className="truncate text-xs text-muted-foreground hover:underline"
          >
            {repo.fullPath}
          </a>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => quickLaunch.launch({ repositoryId: repo.id })}
            disabled={quickLaunch.launching}
            title="Open a terminal on this repo"
          >
            <Terminal className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={runAnalysis}
            disabled={analyzing}
            title="Re-analyze this repo"
          >
            {analyzing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Analysis */}
      <div className="mt-3 space-y-2">
        {analyzing ? (
          <p className="flex items-center gap-1.5 text-xs text-blue-500">
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
          <p className="text-xs text-destructive">
            Analysis failed.{" "}
            <button onClick={runAnalysis} className="underline">
              Retry
            </button>
          </p>
        ) : (
          <button
            onClick={runAnalysis}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
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

  const dot: Record<string, string> = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    down: "bg-red-500",
    idle: "bg-muted-foreground/50",
  };

  return (
    <div className="mt-3 space-y-1.5 border-t border-border/60 pt-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
        <Rocket className="h-3 w-3" />
        Previews
      </p>
      {previews.slice(0, 4).map((p, i) => (
        <a
          key={i}
          href={p.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-xs hover:underline"
        >
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot[p.state])} />
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

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
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

  const load = async () => {
    setError(null);
    try {
      await remote.mutateAsync();
      setLoaded(true);
    } catch (err) {
      // Surface the reason in the dialog (not just a toast that vanishes) —
      // most often "no GitHub connected yet".
      setError(err instanceof Error ? err.message : "Failed to load repos");
      setLoaded(true);
    }
  };

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
        if (o && !loaded) void load();
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect a repository</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
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
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {list.map((r) => (
                <button
                  key={`${r.integrationId}-${r.externalId}`}
                  onClick={() => toggle(r.externalId)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    selected.has(r.externalId)
                      ? "border-primary/40 bg-primary/5"
                      : "border-border hover:bg-muted/40",
                  )}
                >
                  <Github className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate font-medium">{r.name}</p>
                      {r.fullPath.includes("/") && (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
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
