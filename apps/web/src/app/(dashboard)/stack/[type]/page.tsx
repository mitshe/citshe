"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
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
        <p className="text-sm text-muted-foreground">Unknown tool.</p>
        <Link href="/stack" className="text-sm text-primary hover:underline">
          ← Back to stack
        </Link>
      </div>
    );
  }

  const state: HealthState = status?.headline.state ?? "idle";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:py-8">
      <Link
        href="/stack"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-linear hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Stack
      </Link>

      {/* Header: brand + name + health + provider links + actions */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={def.accent}>{def.icon}</span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">
                {def.name}
              </h1>
              {connected && !statusLoading && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-inset px-2 py-0.5 text-[11px] font-medium",
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
          <div className="flex flex-wrap items-center gap-2">
            {(status?.links ?? []).map((l, i) => (
              <a
                key={i}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-linear hover:bg-surface-hover hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {l.label}
              </a>
            ))}
            {def.configurable && (
              <button
                onClick={() => setConfiguring(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-linear hover:bg-surface-hover hover:text-foreground"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Configure
              </button>
            )}
            <button
              onClick={() => setConfirmRemove(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-linear hover:bg-surface-hover hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Disconnect
            </button>
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
        <PluginDashboard type={type} statusLoading={statusLoading} status={status} />
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
        <p className="text-sm font-medium text-danger">Couldn&apos;t reach {type}</p>
        <p className="mt-1 text-xs text-muted-foreground">{status.error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI metric grid */}
      <section className="space-y-2">
        <SectionLabel>Overview</SectionLabel>
        {statusLoading ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <KpiSkeleton key={i} />
            ))}
          </div>
        ) : metrics.length === 0 ? (
          <EmptyState
            icon={<Boxes />}
            title="No metrics yet"
            description="This tool hasn't reported any metrics for this portal."
          />
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {metrics.map((m, i) => (
              <KpiCard key={i} metric={m} />
            ))}
          </div>
        )}
      </section>

      {/* Global actions surfaced from status */}
      {actions.length > 0 && (
        <section className="space-y-2">
          <SectionLabel>Actions</SectionLabel>
          <div className="flex flex-wrap gap-2 rounded-md border border-border bg-surface-card p-3">
            {actions.map((a) => (
              <PluginActionButton key={a.id} type={type} action={a} />
            ))}
          </div>
        </section>
      )}

      {/* Status items (e.g. per-domain / per-zone health rows) */}
      {items.length > 0 && (
        <ResourceSection title="Status">
          {items.map((it, i) => (
            <ResourceRow
              key={i}
              name={it.label}
              state={it.state ?? "idle"}
              meta={it.value}
            />
          ))}
        </ResourceSection>
      )}

      {/* Preview / branch deployments (deploy plugins) */}
      {(previewsLoading || previews.length > 0) && (
        <section className="space-y-2">
          <SectionLabel>
            <Rocket className="mr-1.5 inline h-3 w-3" />
            Deployments
          </SectionLabel>
          <div className="overflow-hidden rounded-md border border-border bg-surface-card">
            {previewsLoading ? (
              <SectionRowsSkeleton />
            ) : (
              previews.map((p, i) => <PreviewRow key={i} preview={p} />)
            )}
          </div>
        </section>
      )}

      {/* Resource sections, grouped by whatever kinds the plugin returns */}
      <section className="space-y-2">
        <SectionLabel>Resources</SectionLabel>
        {resourcesLoading ? (
          <div className="overflow-hidden rounded-md border border-border bg-surface-card">
            <SectionRowsSkeleton />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<Boxes />}
            title="No resources tracked"
            description="Nothing discovered for this token yet. If this tool supports it, use Configure to pick what to track."
          />
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <ResourceGroupPanel
                key={g.kind}
                group={g}
                selectedCount={
                  (resources?.selected as Record<string, string[]> | undefined)?.[
                    g.kind
                  ]?.length
                }
              />
            ))}
          </div>
        )}
      </section>
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
    <div className="rounded-md border border-border bg-surface-card p-3.5 transition-linear">
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
          "mt-1.5 truncate text-2xl font-semibold tracking-tight tabular-nums",
          metric.state ? kpiText[metric.state] : "text-foreground",
        )}
      >
        {metric.value}
      </p>
      {metric.hint && (
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {metric.hint}
        </p>
      )}
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="rounded-md border border-border bg-surface-card p-3.5">
      <div className="h-2.5 w-16 animate-pulse rounded bg-surface-hover" />
      <div className="mt-2.5 h-6 w-20 animate-pulse rounded bg-surface-hover" />
    </div>
  );
}

// ---- Resource sections -----------------------------------------------------

function ResourceGroupPanel({
  group,
  selectedCount,
}: {
  group: PluginResourceGroup;
  selectedCount?: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionLabel>{group.label}</SectionLabel>
        <span className="text-[11px] text-text-subtle">
          {selectedCount
            ? `${selectedCount} tracked · ${group.items.length}`
            : group.items.length}
        </span>
      </div>
      <div className="overflow-hidden rounded-md border border-border bg-surface-card">
        {group.items.length === 0 ? (
          <p className="px-3.5 py-6 text-center text-xs text-muted-foreground">
            None found.
          </p>
        ) : (
          group.items.map((it) => (
            <ResourceRow key={it.id} name={it.name} state="idle" />
          ))
        )}
      </div>
    </div>
  );
}

function ResourceSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <SectionLabel>{title}</SectionLabel>
      <div className="overflow-hidden rounded-md border border-border bg-surface-card">
        {children}
      </div>
    </section>
  );
}

function ResourceRow({
  name,
  state,
  meta,
  href,
}: {
  name: string;
  state: HealthState;
  meta?: string;
  href?: string;
}) {
  const inner = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <StatusDot state={state} size={7} />
        <span className="truncate text-foreground">{name}</span>
      </span>
      {meta && (
        <span className="shrink-0 font-mono text-[11px] text-text-subtle">
          {meta}
        </span>
      )}
    </>
  );

  const cls =
    "flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm border-b border-border last:border-b-0 transition-linear";

  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(cls, "hover:bg-surface-hover")}
    >
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
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
      className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5 text-sm transition-linear last:border-b-0 hover:bg-surface-hover"
    >
      <span className="flex min-w-0 items-center gap-2">
        <StatusDot state={preview.state} size={7} />
        <span className="truncate text-foreground">{label}</span>
        {preview.project && preview.branch && (
          <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {preview.project}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {preview.when && (
          <span className="text-[11px] text-text-subtle">{preview.when}</span>
        )}
        {preview.commit && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {preview.commit}
          </span>
        )}
      </span>
    </a>
  );
}

// ---- misc primitives -------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">
      {children}
    </p>
  );
}

function SectionRowsSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-2 border-b border-border px-3.5 py-3 last:border-b-0"
        >
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-surface-hover" />
          <div className="h-2.5 w-40 animate-pulse rounded bg-surface-hover" />
        </div>
      ))}
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <KpiSkeleton key={i} />
        ))}
      </div>
      <div className="overflow-hidden rounded-md border border-border bg-surface-card">
        <SectionRowsSkeleton />
      </div>
    </div>
  );
}
