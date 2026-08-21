"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  MoreHorizontal,
  Rocket,
  SlidersHorizontal,
  Trash2,
  Boxes,
} from "lucide-react";
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
import { StatusDot } from "@/components/ui/status-dot";
import { EmptyState } from "@/components/ui/empty-state";
import {
  usePlugins,
  useDeletePlugin,
  usePluginStatus,
  usePluginResources,
  usePreviews,
} from "@/lib/api/hooks";
import { getPluginDef } from "@/lib/plugin-catalog";
import { PluginActionButton } from "@/components/plugins/plugin-card";
import { ResourcePicker } from "@/components/plugins/plugin-dialogs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type {
  HealthState,
  PluginType,
  PluginMetric,
  PluginItem,
  PluginResourceGroup,
  PreviewDeployment,
} from "@/lib/api/types";

const healthText: Record<HealthState, string> = {
  ok: "text-ok",
  warn: "text-warn",
  down: "text-danger",
  idle: "text-muted-foreground",
};

export default function StackToolPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type: raw } = use(params);
  const type = raw.toUpperCase() as PluginType;
  const def = getPluginDef(type);
  const router = useRouter();

  const { data: plugins = [], isLoading } = usePlugins();
  const deletePlugin = useDeletePlugin();
  const [configuring, setConfiguring] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const connected = plugins.find((p) => p.type === type);

  const { data: status, isLoading: statusLoading } = usePluginStatus(
    type,
    !!connected,
  );

  if (!def) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <p className="text-muted-foreground">Unknown tool.</p>
        <Link href="/stack" className="text-primary hover:underline">
          ← Back to stack
        </Link>
      </div>
    );
  }

  const state: HealthState = status?.headline.state ?? "idle";
  const primaryLink = status?.links?.[0];
  const extraLinks = status?.links?.slice(1) ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-6 sm:py-10">
      <Link
        href="/stack"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-linear hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Stack
      </Link>

      {/* Header: brand + name + health · Open in provider + ⋯ menu */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-surface-card text-muted-foreground [&_svg]:h-5 [&_svg]:w-5">
            {def.icon}
          </span>
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight">
                {def.name}
              </h1>
              {connected && !statusLoading && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs font-medium",
                    healthText[state],
                  )}
                >
                  <StatusDot state={state} size={8} />
                  {status?.headline.label ?? "—"}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{def.tagline}</p>
          </div>
        </div>

        {connected && (
          <div className="flex items-center gap-2">
            {primaryLink && (
              <a
                href={primaryLink.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/50 px-3 py-1.5 text-sm font-medium text-primary transition-linear hover:bg-primary/10"
              >
                {primaryLink.label}
                <ArrowUpRight className="h-4 w-4" />
              </a>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="More actions"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-linear hover:bg-surface-hover hover:text-foreground"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {extraLinks.map((l, i) => (
                  <DropdownMenuItem key={i} asChild>
                    <a href={l.url} target="_blank" rel="noreferrer">
                      <ArrowUpRight className="h-4 w-4" />
                      {l.label}
                    </a>
                  </DropdownMenuItem>
                ))}
                {def.configurable && (
                  <DropdownMenuItem onSelect={() => setConfiguring(true)}>
                    <SlidersHorizontal className="h-4 w-4" />
                    Configure resources
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => setConfirmRemove(true)}
                  className="text-danger focus:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                  Disconnect
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {isLoading ? (
        <DashboardSkeleton />
      ) : !connected ? (
        <EmptyState
          icon={<Boxes />}
          title={`${def.name} isn't connected`}
          description={`Connect ${def.name} in this portal to see live status, metrics and resources here.`}
          action={
            <Link
              href="/stack"
              className="text-sm font-medium text-primary hover:underline"
            >
              Connect it →
            </Link>
          }
        />
      ) : (
        <PluginDashboard
          type={type}
          statusLoading={statusLoading}
          status={status}
        />
      )}

      {configuring && (
        <ResourcePicker type={type} onClose={() => setConfiguring(false)} />
      )}

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {def.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              citshe will stop reading status from {def.name} for this portal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!connected) return;
                try {
                  await deletePlugin.mutateAsync(connected.id);
                  router.push("/stack");
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Failed to disconnect",
                  );
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================================================================
// Rich, GENERIC plugin dashboard — renders whatever the plugin exposes.
// KPI grid ← status.metrics · sections ← usePluginResources() + usePreviews().
// Works the same for Cloudflare / Vercel / Neon / VPS / Google Ads.
// ============================================================================

function PluginDashboard({
  type,
  status,
  statusLoading,
}: {
  type: PluginType;
  status: ReturnType<typeof usePluginStatus>["data"];
  statusLoading: boolean;
}) {
  const { data: resources, isLoading: resourcesLoading } =
    usePluginResources(type);
  const { data: previews = [], isLoading: previewsLoading } = usePreviews();

  const metrics = status?.metrics ?? [];
  const items = status?.items ?? [];
  const actions = status?.actions ?? [];
  const groups = resources?.groups ?? [];

  if (status?.error) {
    return (
      <div className="rounded-md border border-danger/40 bg-danger/5 p-4">
        <p className="text-sm font-medium text-danger">
          Couldn&apos;t reach {type}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{status.error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Big KPI row — large stat blocks from status.metrics */}
      {statusLoading ? (
        <KpiRowSkeleton />
      ) : metrics.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          title="No metrics yet"
          description="This tool hasn't reported any metrics for this portal."
        />
      ) : (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:grid-cols-4">
          {metrics.map((m, i) => (
            <KpiCard key={i} metric={m} />
          ))}
        </div>
      )}

      {/* Global actions surfaced from status */}
      {actions.length > 0 && (
        <Section title="Actions">
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <PluginActionButton key={a.id} type={type} action={a} />
            ))}
          </div>
        </Section>
      )}

      {/* Deployments — preview/branch deploys from deploy plugins */}
      {(previewsLoading || previews.length > 0) && (
        <Section
          title="Deployments"
          icon={<Rocket className="h-4 w-4" />}
          count={previews.length}
        >
          <Panel>
            {previewsLoading ? (
              <SectionRowsSkeleton />
            ) : (
              previews.map((p, i) => <PreviewRow key={i} preview={p} />)
            )}
          </Panel>
        </Section>
      )}

      {/* Status items — e.g. per-domain / per-zone health rows */}
      {items.length > 0 && (
        <Section title="Status" count={items.length}>
          <Panel>
            {items.map((it, i) => (
              <StatusItemRow key={i} item={it} />
            ))}
          </Panel>
        </Section>
      )}

      {/* Resource groups, generic over whatever kinds the plugin returns */}
      {resourcesLoading ? (
        <Section title="Resources">
          <Panel>
            <SectionRowsSkeleton />
          </Panel>
        </Section>
      ) : groups.length === 0 ? null : (
        groups.map((g) => (
          <ResourceGroupSection
            key={g.kind}
            group={g}
            selectedCount={
              (resources?.selected as Record<string, string[]> | undefined)?.[
                g.kind
              ]?.length
            }
          />
        ))
      )}
    </div>
  );
}

// ---- KPI cards -------------------------------------------------------------

const kpiText: Record<HealthState, string> = {
  ok: "text-ok",
  warn: "text-warn",
  down: "text-danger",
  idle: "text-foreground",
};

function KpiCard({ metric }: { metric: PluginMetric }) {
  return (
    <div className="bg-surface-card p-5">
      <div className="flex items-center gap-1.5">
        {metric.state && metric.state !== "idle" && (
          <StatusDot state={metric.state} size={7} />
        )}
        <p className="truncate text-[11px] font-medium uppercase tracking-wider text-text-subtle">
          {metric.label}
        </p>
      </div>
      <p
        className={cn(
          "mt-2 truncate text-3xl font-semibold tracking-tight tabular-nums",
          metric.state ? kpiText[metric.state] : "text-foreground",
        )}
      >
        {metric.value}
      </p>
      {metric.hint && (
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {metric.hint}
        </p>
      )}
    </div>
  );
}

function KpiRowSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-surface-card p-5">
          <div className="h-2.5 w-16 animate-pulse rounded bg-surface-hover" />
          <div className="mt-3 h-8 w-24 animate-pulse rounded bg-surface-hover" />
        </div>
      ))}
    </div>
  );
}

// ---- Sections / panels -----------------------------------------------------

function Section({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {icon && <span className="text-text-subtle">{icon}</span>}
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {count != null && count > 0 && (
          <span className="rounded-sm bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-card">
      {children}
    </div>
  );
}

function ResourceGroupSection({
  group,
  selectedCount,
}: {
  group: PluginResourceGroup;
  selectedCount?: number;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            {group.label}
          </h2>
          <span className="rounded-sm bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {selectedCount
              ? `${selectedCount} / ${group.items.length}`
              : group.items.length}
          </span>
        </div>
      </div>
      {group.items.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          title={`No ${group.label.toLowerCase()}`}
          description="Nothing discovered for this token yet."
        />
      ) : (
        <Panel>
          {group.items.map((it) => (
            <ResourceRow key={it.id} name={it.name} state="idle" />
          ))}
        </Panel>
      )}
    </section>
  );
}

function ResourceRow({
  name,
  state,
  meta,
}: {
  name: string;
  state: HealthState;
  meta?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 text-sm transition-linear last:border-b-0">
      <span className="flex min-w-0 items-center gap-2.5">
        <StatusDot state={state} size={7} />
        <span className="truncate text-foreground">{name}</span>
      </span>
      {meta && (
        <span className="shrink-0 font-mono text-xs text-text-subtle">
          {meta}
        </span>
      )}
    </div>
  );
}

function StatusItemRow({ item }: { item: PluginItem }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 text-sm transition-linear last:border-b-0">
      <span className="flex min-w-0 items-center gap-2.5">
        <StatusDot state={item.state ?? "idle"} size={7} />
        <span className="truncate text-foreground">{item.label}</span>
      </span>
      <span className="shrink-0 font-mono text-xs text-text-subtle">
        {item.value}
      </span>
    </div>
  );
}

function PreviewRow({ preview }: { preview: PreviewDeployment }) {
  const label =
    preview.branch || preview.project || preview.url.replace(/^https?:\/\//, "");
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm transition-linear last:border-b-0 hover:bg-surface-hover"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <StatusDot state={preview.state} size={7} />
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate font-mono text-foreground">{label}</span>
            {preview.project && preview.branch && (
              <span className="shrink-0 rounded-sm bg-surface-hover px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {preview.project}
              </span>
            )}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-3">
        {preview.commit && (
          <span className="font-mono text-xs text-muted-foreground">
            {preview.commit}
          </span>
        )}
        {preview.when && (
          <span className="text-xs text-text-subtle">{preview.when}</span>
        )}
        <ArrowUpRight className="h-4 w-4 text-text-subtle" />
      </span>
    </a>
  );
}

// ---- skeletons -------------------------------------------------------------

function SectionRowsSkeleton() {
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

function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <KpiRowSkeleton />
      <Panel>
        <SectionRowsSkeleton />
      </Panel>
    </div>
  );
}
