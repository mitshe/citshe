"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowUpRight,
  MoreHorizontal,
  Rocket,
  SlidersHorizontal,
  Trash2,
  Boxes,
  ChevronDown,
  AlertTriangle,
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
import { Chart } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  SectionHeader,
  Eyebrow,
  SectionCount,
} from "@/components/ui/section-header";
import {
  usePlugins,
  useDeletePlugin,
  usePluginStatus,
  usePluginResources,
  usePreviews,
  useRunPluginAction,
} from "@/lib/api/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/api/hooks/shared";
import { VpsAddDialog } from "@/components/plugins/vps-management";
import { Plus } from "lucide-react";
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
  PluginResourceItem,
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
      <div className="w-full max-w-[1400px] px-6 py-6 sm:py-8">
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
    <div className="w-full max-w-[1400px] space-y-6 px-6 py-6 sm:py-8">
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
              <Button variant="outline" asChild>
                <a href={primaryLink.url} target="_blank" rel="noreferrer">
                  {primaryLink.label}
                  <ArrowUpRight className="h-4 w-4" />
                </a>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="More actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
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

/**
 * Decide where a metric belongs in the 2-column layout. Respects an explicit
 * `metric.section` hint from the plugin; otherwise classifies by label keyword
 * (case-insensitive). HERO = the top "what's live" strip. USAGE = the right
 * rail "Usage" block (storage / compute used / transfer / traffic). DETAILS =
 * everything else (region / plan / version / counts) → right rail "Details".
 */
function classifyMetric(m: PluginMetric): "hero" | "details" | "usage" {
  if (m.section) return m.section;
  const l = m.label.toLowerCase();

  // HERO — headline state of the thing right now.
  if (
    l.includes("last deploy") ||
    l.includes("compute state") ||
    /\bup\b/.test(l) ||
    l.includes("connected")
  )
    return "hero";

  // USAGE — consumption over a billing period / traffic volume.
  if (
    l.includes("requests") ||
    l.includes("bandwidth") ||
    l.includes("compute used") ||
    l.includes("data transfer") ||
    l.includes("storage") ||
    l.includes("size") ||
    l.includes("network")
  )
    return "usage";

  // DETAILS — properties and counts.
  return "details";
}

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
  const links = status?.links ?? [];
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

  // Time-series metrics own the "Monitoring" block (big charts, left column).
  // They are pulled OUT of the hero / rail / stat-strip buckets so a series
  // metric never also renders as a tiny sparkline.
  const seriesMetrics = metrics.filter(
    (m) => Array.isArray(m.series) && m.series.length > 1,
  );
  const plainMetrics = metrics.filter(
    (m) => !(Array.isArray(m.series) && m.series.length > 1),
  );

  // Metric classification for the hero strip + right rail blocks (non-series).
  const heroMetrics = plainMetrics.filter((m) => classifyMetric(m) === "hero");
  const detailMetrics = plainMetrics.filter(
    (m) => classifyMetric(m) === "details",
  );
  const usageMetrics = plainMetrics.filter(
    (m) => classifyMetric(m) === "usage",
  );

  // "Last 24h" style traffic metrics — a slim stat strip in the left column.
  // These are the usage metrics that read as point-in-time counts (Cloudflare
  // requests / bandwidth / cached / threats), not billing-period totals.
  const trafficMetrics = usageMetrics.filter((m) => {
    const l = m.label.toLowerCase();
    return (
      l.includes("requests") ||
      l.includes("bandwidth") ||
      l.includes("cached") ||
      l.includes("threats")
    );
  });

  // Resource groups: pull deployments out to lead the left column; the VPS
  // "servers" group is rendered by its own managed section.
  const deploymentsGroup = groups.find((g) => g.kind === "deployments");
  const otherGroups = groups.filter(
    (g) =>
      g.kind !== "deployments" && !(type === "VPS" && g.kind === "servers"),
  );

  // Hero active deployment — prefer an active resource deployment, else an
  // active/ready preview.
  const activeDeployment = deploymentsGroup?.items.find((i) => i.active);
  const activePreview = previews.find(
    (p) => p.state === "ok" || p.state === "idle",
  );

  const primaryLink = links[0];
  const railHasContent =
    detailMetrics.length > 0 || usageMetrics.length > 0 || links.length > 0;

  if (statusLoading && resourcesLoading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      {/* ===================== LEFT (main) ===================== */}
      <div className="min-w-0 space-y-6">
        {/* HERO — what's live right now. */}
        {statusLoading ? (
          <HeroSkeleton />
        ) : (
          <HeroBlock
            headline={status?.headline}
            heroMetrics={heroMetrics}
            activeDeployment={activeDeployment}
            activePreview={activePreview}
            primaryLink={primaryLink}
          />
        )}

        {/* Actions surfaced from status. */}
        {actions.length > 0 && (
          <Block title="Actions">
            <div className="flex flex-wrap gap-2 p-4">
              {actions.map((a) => (
                <PluginActionButton key={a.id} type={type} action={a} />
              ))}
            </div>
          </Block>
        )}

        {/* Monitoring — big time-series charts (Neon / Cloudflare / Vercel). */}
        {seriesMetrics.length > 0 && (
          <Block title="Monitoring">
            <div
              className={cn(
                "grid gap-px bg-border",
                seriesMetrics.length > 1 && "sm:grid-cols-2",
              )}
            >
              {seriesMetrics.map((m, i) => (
                <MonitoringCard key={i} metric={m} />
              ))}
            </div>
          </Block>
        )}

        {/* Last 24h traffic strip (Cloudflare). */}
        {trafficMetrics.length > 0 && (
          <Block title="Last 24h">
            <StatStrip metrics={trafficMetrics} />
          </Block>
        )}

        {/* Deployments — previews + the deployments resource group. */}
        {(previewsLoading ||
          previews.length > 0 ||
          (deploymentsGroup?.items.length ?? 0) > 0) && (
          <Block
            title="Deployments"
            icon={<Rocket className="h-4 w-4" />}
            count={
              previews.length + (deploymentsGroup?.items.length ?? 0) ||
              undefined
            }
          >
            {previewsLoading && previews.length === 0 && !deploymentsGroup ? (
              <SectionRowsSkeleton />
            ) : (
              <DeploymentsBody
                previews={previews}
                group={deploymentsGroup}
              />
            )}
          </Block>
        )}

        {/* VPS: managed list of servers (add / remove). */}
        {type === "VPS" && (
          <VpsServersSection
            group={groups.find((g) => g.kind === "servers")}
            loading={resourcesLoading}
          />
        )}

        {/* Status items — per-domain / per-zone health rows. */}
        {items.length > 0 && (
          <Block title="Status" count={items.length}>
            <CollapsibleListBody
              items={items}
              renderItem={(it, i) => <StatusItemRow key={i} item={it} />}
            />
          </Block>
        )}

        {/* Remaining resource groups, each as its own titled block. */}
        {resourcesLoading && otherGroups.length === 0 && type !== "VPS" ? (
          <Block title="Resources">
            <SectionRowsSkeleton />
          </Block>
        ) : (
          otherGroups.map((g) => (
            <ResourceGroupBlock
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

      {/* ===================== RIGHT (rail) ===================== */}
      <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
        {statusLoading ? (
          <RailSkeleton />
        ) : !railHasContent ? null : (
          <>
            {detailMetrics.length > 0 && (
              <RailBlock title="Details">
                {detailMetrics.map((m, i) => (
                  <KV
                    key={i}
                    label={m.label}
                    value={m.value}
                    state={m.state}
                    hint={m.hint}
                  />
                ))}
              </RailBlock>
            )}

            {usageMetrics.length > 0 && (
              <RailBlock title="Usage">
                {usageMetrics.map((m, i) => (
                  <KV
                    key={i}
                    label={m.label}
                    value={m.value}
                    state={m.state}
                    hint={m.hint}
                  />
                ))}
              </RailBlock>
            )}

            {links.length > 0 && (
              <RailBlock title="Links">
                {links.map((l, i) => (
                  <KVLink key={i} label={l.label} url={l.url} />
                ))}
              </RailBlock>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

// ---- Hero ------------------------------------------------------------------

/**
 * The top "what's live" block. If there's an active deployment (resource group
 * or a ready preview) it leads with the commit message + Live badge + branch ·
 * #sha · author · when and the primary link. Otherwise it shows the health
 * headline plus any HERO-classified metrics inline. Never empty — the headline
 * is always shown.
 */
function HeroBlock({
  headline,
  heroMetrics,
  activeDeployment,
  activePreview,
  primaryLink,
}: {
  headline?: { label: string; state: HealthState };
  heroMetrics: PluginMetric[];
  activeDeployment?: PluginResourceItem;
  activePreview?: PreviewDeployment;
  primaryLink?: { label: string; url: string };
}) {
  const state = headline?.state ?? "idle";

  // Prefer a rich active deployment hero.
  const dep = activeDeployment;
  const commitMsg =
    dep?.name || activePreview?.branch || activePreview?.project;
  const showDeployHero = !!dep || !!activePreview;

  const metaParts = dep
    ? ([
        dep.environment,
        dep.branch,
        dep.sha ? `#${dep.sha}` : undefined,
        dep.author,
        dep.when,
      ].filter(Boolean) as string[])
    : ([
        activePreview?.branch,
        activePreview?.commit ? `#${activePreview.commit}` : undefined,
        activePreview?.when,
      ].filter(Boolean) as string[]);

  const link = primaryLink ?? (activePreview ? { label: "Open", url: activePreview.url } : undefined);

  return (
    <div className="rounded-lg border border-border bg-surface-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <Eyebrow>Overview</Eyebrow>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium",
            healthText[state],
          )}
        >
          <StatusDot state={state} size={7} />
          {headline?.label ?? "—"}
        </span>
      </div>

      <div className="space-y-3 p-4">
        {showDeployHero ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                    <StatusDot state="ok" size={5} />
                    Live
                  </span>
                </div>
                <p className="mt-1.5 break-words text-base font-medium text-foreground">
                  {commitMsg}
                </p>
                {metaParts.length > 0 && (
                  <p className="mt-1 font-mono text-xs text-text-subtle">
                    {metaParts.join(" · ")}
                  </p>
                )}
              </div>
            </div>
            {link && (
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                {link.label}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <StatusDot state={state} size={10} />
              <span className="text-lg font-semibold text-foreground">
                {headline?.label ?? "—"}
              </span>
            </div>
            {heroMetrics.length > 0 && (
              <dl className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                {heroMetrics.map((m, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    {m.state && m.state !== "idle" && (
                      <StatusDot state={m.state} size={6} />
                    )}
                    <dt className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">
                      {m.label}
                    </dt>
                    <dd
                      className={cn(
                        "font-medium tabular-nums",
                        m.state ? metricText[m.state] : "text-foreground",
                      )}
                    >
                      {m.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---- Left-column blocks ----------------------------------------------------

/**
 * A titled left-column card: header (eyebrow + optional icon + count) and a
 * bordered body. The distinct-block wrapper the redesign is built around.
 */
function Block({
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
      </div>
      {children}
    </section>
  );
}

/**
 * CollapsibleList body without the outer Panel border — for use inside a Block
 * (which already provides the card chrome). Shows 5 items + "Show more".
 */
function CollapsibleListBody<T>({
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
          className="flex w-full items-center justify-center gap-1.5 border-t border-border px-4 py-2 text-xs font-medium text-muted-foreground transition-linear hover:bg-surface-hover hover:text-foreground"
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

/**
 * Deployments block body: merges previews with the deployments resource group,
 * pinning the active/live one first. Reuses DeploymentRow + PreviewRow.
 */
function DeploymentsBody({
  previews,
  group,
}: {
  previews: PreviewDeployment[];
  group?: PluginResourceGroup;
}) {
  const groupItems = group
    ? [...group.items].sort(
        (a, b) => Number(b.active ?? false) - Number(a.active ?? false),
      )
    : [];

  // Render group deployments first (they carry active state), then previews.
  const rows: React.ReactNode[] = [
    ...groupItems.map((it) => <DeploymentRow key={`d-${it.id}`} item={it} />),
    ...previews.map((p, i) => <PreviewRow key={`p-${i}`} preview={p} />),
  ];

  const [expanded, setExpanded] = useState(false);
  const hidden = rows.length - DEFAULT_VISIBLE;
  const visible = expanded ? rows : rows.slice(0, DEFAULT_VISIBLE);

  return (
    <>
      {visible}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border px-4 py-2 text-xs font-medium text-muted-foreground transition-linear hover:bg-surface-hover hover:text-foreground"
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

/** A resource group (Branches / Domains / R2 / Databases…) as a titled Block. */
function ResourceGroupBlock({
  group,
  selectedCount,
}: {
  group: PluginResourceGroup;
  selectedCount?: number;
}) {
  if (group.items.length === 0) return null;
  return (
    <Block
      title={group.label}
      count={selectedCount ?? group.items.length}
    >
      <CollapsibleListBody
        items={group.items}
        renderItem={(it) => (
          <ResourceRow
            key={it.id}
            name={it.name}
            state={it.state ?? "idle"}
            meta={it.meta}
          />
        )}
      />
    </Block>
  );
}

/**
 * Derive X-axis labels for a series from the metric hint. Reads a duration like
 * "48h" / "24h" / "14d" out of the label/hint and produces "<n> ago" … "now"
 * anchored to the first & last points; middle points get "". Falls back to
 * "start" … "now" when no duration is found.
 */
function deriveXLabels(m: PluginMetric): string[] | undefined {
  const n = m.series?.length ?? 0;
  if (n < 2) return undefined;
  const text = `${m.label} ${m.hint ?? ""}`.toLowerCase();
  const match = text.match(/(\d+)\s*(h|hr|hrs|hour|hours|d|day|days|m|min)/);
  const labels = new Array(n).fill("");
  labels[n - 1] = "now";
  if (match) {
    const span = match[1];
    const unitRaw = match[2];
    const unit = unitRaw.startsWith("h")
      ? "h"
      : unitRaw.startsWith("d")
        ? "d"
        : "m";
    labels[0] = `${span}${unit} ago`;
  } else {
    labels[0] = "start";
  }
  return labels;
}

/**
 * One big chart card in the Monitoring block: metric label heading, the current
 * value (big, + hint), then a full recharts Chart below. Mirrors Neon "Postgres
 * Monitoring" / Vercel "Edge Requests" cards.
 */
function MonitoringCard({ metric: m }: { metric: PluginMetric }) {
  const kind = m.seriesKind === "bar" ? "bar" : "area";
  const xLabels = deriveXLabels(m);
  return (
    <div className="bg-surface-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">
            {m.label}
          </div>
          <div
            className={cn(
              "mt-0.5 text-xl font-semibold tabular-nums",
              m.state ? metricText[m.state] : "text-foreground",
            )}
          >
            {m.value}
          </div>
        </div>
        {m.hint && (
          <span className="shrink-0 text-[11px] text-text-subtle">
            {m.hint}
          </span>
        )}
      </div>
      <Chart
        data={m.series!}
        kind={kind}
        label={m.label}
        xLabels={xLabels}
        className="mt-3"
        height={180}
      />
    </div>
  );
}

/**
 * A slim horizontal stat strip for "Last 24h" style traffic metrics: label
 * above a big-ish number, laid out in a responsive row inside a block body.
 */
function StatStrip({ metrics }: { metrics: PluginMetric[] }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-border sm:grid-cols-4">
      {metrics.map((m, i) => (
        <div key={i} className="px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">
            {m.label}
          </div>
          <div
            className={cn(
              "mt-0.5 text-lg font-semibold tabular-nums",
              m.state ? metricText[m.state] : "text-foreground",
            )}
          >
            {m.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Right rail ------------------------------------------------------------

/**
 * A grouped right-rail card (Details / Usage / Links). Dense key→value rows
 * with a collapsible header on desktop.
 */
function RailBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 transition-linear hover:bg-surface-hover"
      >
        <Eyebrow>{title}</Eyebrow>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-text-subtle transition-linear",
            !open && "-rotate-90",
          )}
        />
      </button>
      {open && <dl className="border-t border-border">{children}</dl>}
    </section>
  );
}

/** One label→value rail row. Full value, wraps rather than truncating. */
function KV({
  label,
  value,
  state,
  hint,
}: {
  label: string;
  value: string;
  state?: HealthState;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-2 not-last:border-b not-last:border-border">
      <dt className="shrink-0 pt-px text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">
        <span className="flex items-center justify-end gap-1.5">
          {state && state !== "idle" && <StatusDot state={state} size={6} />}
          <span
            className={cn(
              "break-words text-sm font-medium",
              state ? metricText[state] : "text-foreground",
            )}
          >
            {value}
          </span>
        </span>
        {hint && (
          <span className="mt-0.5 block text-[11px] text-text-subtle">
            {hint}
          </span>
        )}
      </dd>
    </div>
  );
}

/** A rail row that links out (Open in X →). */
function KVLink({ label, url }: { label: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-3 px-4 py-2 transition-linear not-last:border-b not-last:border-border hover:bg-surface-hover"
    >
      <span className="min-w-0 break-words text-sm font-medium text-foreground">
        {label}
      </span>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
    </a>
  );
}

// ---- Show-more mechanism ---------------------------------------------------

const DEFAULT_VISIBLE = 5;

/**
 * Renders the first N (=5) items in a bordered Panel and, when there are more,
 * a "Show more (N)" footer button that expands the full list IN PLACE (local
 * state, toggles to "Show less"). Generic over any item type — used for
 * deployments, previews, status items, resource rows and servers so a group of
 * 15 identical rows never forces the user to scroll past all of them.
 */
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
    <Panel>
      {visible.map((item, i) => renderItem(item, i))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border px-4 py-2 text-xs font-medium text-muted-foreground transition-linear hover:bg-surface-hover hover:text-foreground"
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
    </Panel>
  );
}

// ---- VPS server management (add / remove) ----------------------------------

function VpsServersSection({
  group,
  loading,
}: {
  group: PluginResourceGroup | undefined;
  loading: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const runAction = useRunPluginAction("VPS");
  const queryClient = useQueryClient();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const items = group?.items ?? [];

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });

  const remove = async (id: string) => {
    setRemovingId(id);
    try {
      const res = await runAction.mutateAsync({
        actionId: "remove-server",
        input: { id },
      });
      if (!res.ok) throw new Error(res.message);
      toast.success(res.message);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setRemovingId(null);
      setConfirmId(null);
    }
  };

  return (
    <section className="space-y-2.5">
      <SectionHeader
        label="Servers"
        count={items.length}
        action={
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add VPS
          </Button>
        }
      />

      {loading ? (
        <Panel>
          <SectionRowsSkeleton />
        </Panel>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          title="No servers yet"
          description="Add your first VPS to start seeing its health here."
        />
      ) : (
        <CollapsibleList
          items={items}
          renderItem={(it) => (
            <VpsServerRow
              key={it.id}
              item={it}
              removing={removingId === it.id}
              onRemove={() => setConfirmId(it.id)}
            />
          )}
        />
      )}

      {adding && (
        <VpsAddDialog
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}

      <AlertDialog
        open={confirmId != null}
        onOpenChange={(o) => !o && setConfirmId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this server?</AlertDialogTitle>
            <AlertDialogDescription>
              citshe will stop reading health from this server. You can add it
              back anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmId && remove(confirmId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/**
 * One VPS server row: a clickable header (status + name + compact meta) that
 * expands to a grid of rich SSH-read stats (uptime / load / RAM / disk / CPU /
 * OS …). If the server is unreachable, its error is shown inline on the row.
 */
function VpsServerRow({
  item,
  removing,
  onRemove,
}: {
  item: PluginResourceItem;
  removing: boolean;
  onRemove: () => void;
}) {
  const details = item.details ?? [];
  const hasDetails = details.length > 0;
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
        <button
          type="button"
          onClick={() => hasDetails && setOpen((o) => !o)}
          disabled={!hasDetails}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5 text-left transition-linear",
            hasDetails ? "hover:text-foreground" : "cursor-default",
          )}
        >
          <StatusDot state={item.state ?? "idle"} size={7} />
          <span className="truncate text-foreground">{item.name}</span>
          {hasDetails && (
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-linear",
                open && "rotate-180",
              )}
            />
          )}
        </button>
        <span className="flex shrink-0 items-center gap-3">
          {item.meta && (
            <span className="hidden font-mono text-xs text-text-subtle sm:inline">
              {item.meta}
            </span>
          )}
          <button
            aria-label="Remove server"
            onClick={onRemove}
            disabled={removing}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-linear hover:bg-surface-hover hover:text-danger disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>

      {/* Inline error for an unreachable server — scoped to its own row. */}
      {item.error && (
        <div className="flex items-start gap-2 px-4 pb-3 text-xs text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{item.error}</span>
        </div>
      )}

      {/* Expandable rich metrics panel. */}
      {open && hasDetails && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border bg-surface-hover/40 px-4 py-3 sm:grid-cols-3">
          {details.map((d, i) => (
            <div key={i} className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {d.label}
              </div>
              <div
                className={cn(
                  "truncate font-mono text-xs",
                  d.state ? healthText[d.state] : "text-foreground",
                )}
                title={d.value}
              >
                {d.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Summary bar -----------------------------------------------------------

const metricText: Record<HealthState, string> = {
  ok: "text-ok",
  warn: "text-warn",
  down: "text-danger",
  idle: "text-foreground",
};

// ---- Panels ----------------------------------------------------------------

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-card">
      {children}
    </div>
  );
}

/**
 * A rich deployment row (Cloudflare + Vercel). Leads with the commit message,
 * conveys state via the StatusDot (green = ready — we don't repeat "success"),
 * and shows env · branch · #sha · time on the right. The live/active
 * deployment gets a primary-tinted row, a left accent bar and a "Live" badge.
 */
function DeploymentRow({ item }: { item: PluginResourceItem }) {
  const active = !!item.active;
  const metaParts = [
    item.environment,
    item.branch,
    item.sha ? `#${item.sha}` : undefined,
    item.when,
  ].filter(Boolean) as string[];
  // Fall back to the plugin's prebuilt meta line if structured fields are absent.
  const meta = metaParts.length ? metaParts.join(" · ") : item.meta;

  return (
    <div
      className={cn(
        "relative flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-sm transition-linear last:border-b-0",
        active && "bg-primary/5",
      )}
    >
      {active && (
        <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" aria-hidden />
      )}
      <span className="flex min-w-0 items-center gap-2.5">
        <StatusDot state={item.state ?? "idle"} size={7} />
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate text-foreground">{item.name}</span>
            {active && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                <StatusDot state="ok" size={5} />
                Live
              </span>
            )}
          </span>
          {item.author && (
            <span className="mt-0.5 block truncate text-xs text-text-subtle">
              {item.author}
            </span>
          )}
        </span>
      </span>
      {meta && (
        <span className="shrink-0 font-mono text-xs text-text-subtle">
          {meta}
        </span>
      )}
    </div>
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
    <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 text-sm transition-linear last:border-b-0">
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
    <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 text-sm transition-linear last:border-b-0">
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
      className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-sm transition-linear last:border-b-0 hover:bg-surface-hover"
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

function HeroSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface-card">
      <div className="border-b border-border px-4 py-2.5">
        <div className="h-3 w-20 animate-pulse rounded bg-surface-hover" />
      </div>
      <div className="space-y-3 p-4">
        <div className="h-5 w-64 animate-pulse rounded bg-surface-hover" />
        <div className="h-3 w-40 animate-pulse rounded bg-surface-hover" />
      </div>
    </div>
  );
}

function RailSkeleton() {
  return (
    <>
      {Array.from({ length: 2 }).map((_, b) => (
        <div
          key={b}
          className="overflow-hidden rounded-lg border border-border bg-surface-card"
        >
          <div className="border-b border-border px-4 py-2.5">
            <div className="h-3 w-16 animate-pulse rounded bg-surface-hover" />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-4 py-2"
              >
                <div className="h-3 w-16 animate-pulse rounded bg-surface-hover" />
                <div className="h-3 w-20 animate-pulse rounded bg-surface-hover" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-6">
        <HeroSkeleton />
        <div className="overflow-hidden rounded-lg border border-border bg-surface-card">
          <div className="border-b border-border px-4 py-2.5">
            <div className="h-3 w-24 animate-pulse rounded bg-surface-hover" />
          </div>
          <SectionRowsSkeleton />
        </div>
      </div>
      <div className="space-y-6">
        <RailSkeleton />
      </div>
    </div>
  );
}
