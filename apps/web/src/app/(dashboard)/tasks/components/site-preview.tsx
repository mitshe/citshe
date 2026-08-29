"use client";

import { useState } from "react";
import {
  ExternalLink,
  RefreshCw,
  Monitor,
  Smartphone,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/section-header";
import { cn } from "@/lib/utils";

type Viewport = "desktop" | "mobile";

/**
 * Phase 1 of the visual editor: show the deployed site inside citshe. A plain
 * iframe of the public URL (our CF Pages / Vercel sites allow framing) with a
 * refresh, an open-live link, and a desktop/mobile toggle. If a site blocks
 * framing (X-Frame-Options), the user still has "Open live". No backend —
 * editing (point-and-describe) is a later phase.
 */
export function SitePreview({ url }: { url: string }) {
  const [viewport, setViewport] = useState<Viewport>("desktop");
  // Bumping the key remounts the iframe → forces a reload (can't read a
  // cross-origin frame's location to refresh it directly).
  const [reloadKey, setReloadKey] = useState(0);
  const [blocked, setBlocked] = useState(false);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>Preview</Eyebrow>
        <div className="flex items-center gap-1">
          <div className="mr-1 hidden items-center rounded-md border border-border bg-surface-inset p-0.5 sm:flex">
            {(
              [
                ["desktop", Monitor],
                ["mobile", Smartphone],
              ] as const
            ).map(([v, Icon]) => (
              <button
                key={v}
                type="button"
                onClick={() => setViewport(v)}
                aria-label={v}
                className={cn(
                  "rounded p-1 transition-linear",
                  viewport === v
                    ? "bg-surface-card text-foreground shadow-sm"
                    : "text-text-subtle hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setBlocked(false);
              setReloadKey((k) => k + 1);
            }}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
          <a href={url} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="sm">
              Open live
              <ExternalLink className="ml-1.5 h-3 w-3 opacity-60" />
            </Button>
          </a>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface-inset">
        {blocked ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
            <AlertCircle className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              This site can&apos;t be previewed inline (it blocks embedding).
            </p>
            <a href={url} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">
                Open live
                <ExternalLink className="ml-1.5 h-3 w-3 opacity-60" />
              </Button>
            </a>
          </div>
        ) : (
          <div className="flex justify-center bg-surface-inset">
            <iframe
              key={reloadKey}
              src={url}
              title="Site preview"
              loading="lazy"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              onError={() => setBlocked(true)}
              className={cn(
                "h-[520px] border-0 bg-white transition-all",
                viewport === "mobile" ? "w-[390px]" : "w-full",
              )}
            />
          </div>
        )}
      </div>
    </section>
  );
}
