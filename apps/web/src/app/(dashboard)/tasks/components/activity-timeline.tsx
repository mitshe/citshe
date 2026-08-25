"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Globe, Sparkles } from "lucide-react";
import { ClaudeLogo } from "@/components/ui/claude-logo";
import { Eyebrow } from "@/components/ui/section-header";
import { formatDistanceToNow } from "@/lib/utils";
import { useAuthToken } from "@/lib/api/hooks/shared";

/**
 * The human-readable activity feed for a worker run — Claude's notes,
 * screenshots, the run summary, "site deployed" links, plus any user comments.
 * Reads `task.agentLogs`. Rendered both in the task detail and in the session
 * view's "Progress" tab (so a non-dev watches this instead of the raw terminal).
 *
 * Self-contained on purpose: the narrowing helpers + attachment loader live here
 * so the tab can drop in anywhere without dragging the whole task-detail along.
 */

export interface AgentLogEntry {
  agentName: string;
  action: string;
  details?: unknown;
  timestamp?: string;
  author?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

function actionLabel(
  action: string,
  ctx: { shot: boolean; isComment: boolean },
): string {
  if (ctx.shot) return "attached a screenshot";
  if (ctx.isComment) return "commented";
  switch (action) {
    case "executing":
      return "started working";
    case "finished":
      return "finished";
    case "failed":
      return "failed";
    case "note":
      return "";
    case "site":
      return "deployed the site";
    default:
      return action;
  }
}

/** Pull a human-readable summary out of task.result, if any. */
export function extractResultSummary(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  for (const key of ["summary", "analysis", "message", "description"]) {
    const value = result[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

/** Narrow task.agentLogs (unknown JSON) into a clean array of entries. */
export function normalizeAgentLogs(raw: unknown): AgentLogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map((entry) => ({
    agentName: asString(entry.agentName) ?? "agent",
    action: asString(entry.action) ?? "",
    details: entry.details,
    timestamp: asString(entry.timestamp),
    author: asString(entry.author),
  }));
}

function screenshotDetails(
  details: unknown,
): { attachmentId: string; caption?: string } | null {
  if (!isRecord(details)) return null;
  const attachmentId = asString(details.attachmentId);
  if (!attachmentId) return null;
  return { attachmentId, caption: asString(details.caption) ?? undefined };
}

/**
 * Loads a task attachment (screenshot) as an object URL — the GET route is
 * bearer-authed so <img src> can't hit it directly. Click opens a lightbox.
 */
function AttachmentImage({
  taskId,
  attachmentId,
  caption,
}: {
  taskId: string;
  attachmentId: string;
  caption?: string;
}) {
  const getToken = useAuthToken();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(
          `/api/v1/tasks/${taskId}/attachments/${attachmentId}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
        );
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (!revoked) setFailed(true);
      }
    })();
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [taskId, attachmentId, getToken]);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomed(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);

  if (failed) {
    return (
      <p className="mt-1.5 text-xs italic text-text-subtle">
        Couldn&apos;t load screenshot.
      </p>
    );
  }
  if (!url) {
    return (
      <div className="mt-1.5 h-32 w-full max-w-sm animate-pulse rounded-md border border-border bg-surface-hover" />
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setZoomed(true)}
        className="mt-1.5 block overflow-hidden rounded-md border border-border transition-linear hover:border-border-strong"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={caption ?? "screenshot"}
          className="max-h-64 w-auto max-w-full"
        />
      </button>
      {caption && (
        <p className="mt-1 text-xs text-text-subtle">{caption}</p>
      )}
      {zoomed && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setZoomed(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={caption ?? "screenshot"}
            className="max-h-full max-w-full rounded-md"
          />
        </div>
      )}
    </>
  );
}

export function ActivityTimeline({
  taskId,
  agentLogs,
  resultSummary,
  emptyLabel = "No activity yet.",
}: {
  taskId: string;
  agentLogs: AgentLogEntry[];
  resultSummary?: string;
  emptyLabel?: string;
}) {
  return (
    <section className="space-y-3">
      <Eyebrow>Activity</Eyebrow>

      {resultSummary && (
        <div className="rounded-lg border border-primary/20 bg-primary/[0.04] p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            AI Summary
          </div>
          <p className="whitespace-pre-wrap text-sm text-foreground">
            {resultSummary}
          </p>
        </div>
      )}

      {agentLogs.length > 0 ? (
        <ol className="space-y-3">
          {[...agentLogs].reverse().map((entry, index) => {
            const isComment =
              entry.author === "user" || entry.action === "comment";
            const shot =
              entry.action === "screenshot"
                ? screenshotDetails(entry.details)
                : null;
            const isNote = entry.action === "note";
            const commentText =
              isComment || isNote
                ? asString((entry.details as { text?: unknown })?.text)
                : undefined;
            const summaryText =
              entry.action === "finished"
                ? asString(
                    (entry.details as { summary?: unknown })?.summary,
                  )?.trim()
                : undefined;
            const siteLink =
              entry.action === "site"
                ? asString((entry.details as { url?: unknown })?.url)?.trim()
                : undefined;
            const isLast = index === agentLogs.length - 1;
            return (
              <li key={index} className="relative flex gap-3 pb-1">
                {!isLast && (
                  <span
                    className="absolute left-[13px] top-8 bottom-0 w-px bg-border"
                    aria-hidden
                  />
                )}
                {isComment ? (
                  <span className="z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-hover text-[11px] font-semibold text-muted-foreground ring-4 ring-surface-card">
                    {initials(entry.agentName)}
                  </span>
                ) : (
                  <span
                    className="z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-4 ring-surface-card"
                    style={{ backgroundColor: "#D97757" }}
                  >
                    <ClaudeLogo className="h-4 w-4 text-white" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium text-foreground">
                      {entry.agentName === "worker" ? "Claude" : entry.agentName}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {actionLabel(entry.action, { shot: !!shot, isComment })}
                    </span>
                    {entry.timestamp && (
                      <span className="text-xs text-text-subtle">
                        {formatDistanceToNow(new Date(entry.timestamp))}
                      </span>
                    )}
                  </div>
                  {commentText && (
                    <p className="mt-1 whitespace-pre-wrap break-words rounded-md border border-border bg-surface-card px-3 py-2 text-sm text-foreground">
                      {commentText}
                    </p>
                  )}
                  {summaryText && (
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {summaryText}
                    </p>
                  )}
                  {siteLink && (
                    <a
                      href={siteLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-linear hover:bg-primary/15"
                    >
                      <Globe className="h-3.5 w-3.5" />
                      {siteLink}
                      <ExternalLink className="h-3 w-3 opacity-70" />
                    </a>
                  )}
                  {shot && (
                    <AttachmentImage
                      taskId={taskId}
                      attachmentId={shot.attachmentId}
                      caption={shot.caption}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        !resultSummary && (
          <p className="text-sm italic text-text-subtle">{emptyLabel}</p>
        )
      )}
    </section>
  );
}
