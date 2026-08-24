"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  GitBranch,
  Loader2,
  RefreshCw,
  Rocket,
  Settings2,
  Sparkles,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Chip } from "@/components/ui/chip";
import { RadioCard } from "@/components/ui/radio-card";
import { WizardProgress } from "@/components/ui/wizard-progress";
import { CreateOrgDialog } from "@/components/layout/create-org-dialog";
import { useAuthContext } from "@/lib/auth";
import { useCreateTask, useBuildTask } from "@/lib/api/hooks/tasks";
import { useCopyConnections } from "@/lib/api/hooks/plugins";
import { Connectors } from "./connectors";
import type { BuildMode, BuildSpec, RepoVisibility } from "@citshe/types";

/**
 * The "New portal" flow, rendered as a full page (route: /new-portal) inside
 * the dashboard shell. One entry, branching into:
 *   entry:    new project (guided)  |  existing repo (→ plain create dialog)
 *   mode:     from scratch          |  refresh an existing site
 *   describe: name + prompt (+ source URL) + advanced overrides
 *   connect:  GitHub (required) + Cloudflare/Vercel/Neon (recommended)
 *   review:   summary + Build
 * On build: creates the portal, creates a build task, kicks it off, and jumps
 * to the task so the user watches Claude work.
 */

type Entry = "new" | "existing";
type Step = "entry" | "mode" | "describe" | "connect" | "review";

const NEW_STEPS: Step[] = ["entry", "mode", "describe", "connect", "review"];

const PROMPT_CHIPS = [
  "content blog",
  "landing page",
  "app with login",
  "online store",
  "dark theme",
  "in Polish",
];

export function NewPortalPage() {
  const router = useRouter();
  const { createOrganization } = useAuthContext();
  const createTask = useCreateTask();
  const buildTask = useBuildTask();
  const copyConnections = useCopyConnections();

  // "Copy tools from another portal" — the source org id, applied after the new
  // portal is created (the target org doesn't exist until then).
  const [copyFromOrgId, setCopyFromOrgId] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("entry");
  const [entry, setEntry] = useState<Entry | null>(null);
  const [mode, setMode] = useState<BuildMode | null>(null);

  const [name, setName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [prompt, setPrompt] = useState("");

  // Advanced (hidden by default; non-technical users never open it).
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [visibility, setVisibility] = useState<RepoVisibility>("private");
  const [stackHint, setStackHint] = useState<BuildSpec["stackHint"]>(undefined);
  const [hostingHint, setHostingHint] =
    useState<BuildSpec["hostingHint"]>(undefined);

  const [building, setBuilding] = useState(false);
  const [plainCreateOpen, setPlainCreateOpen] = useState(false);

  const stepIndex = NEW_STEPS.indexOf(step);

  const leave = () => router.push("/home");

  const goBack = () => {
    if (stepIndex <= 0) {
      leave();
      return;
    }
    setStep(NEW_STEPS[stepIndex - 1]);
  };

  const canContinue = (): boolean => {
    switch (step) {
      case "entry":
        return entry !== null;
      case "mode":
        return mode !== null;
      case "describe":
        return (
          name.trim().length > 0 &&
          prompt.trim().length > 0 &&
          (mode !== "refresh" || isValidUrl(sourceUrl))
        );
      case "connect":
        return true; // GitHub is validated at build time
      default:
        return true;
    }
  };

  const advance = () => {
    if (step === "entry" && entry === "existing") {
      // "I already have a repo" → the plain create-portal dialog.
      setPlainCreateOpen(true);
      return;
    }
    const next = NEW_STEPS[stepIndex + 1];
    if (next) setStep(next);
  };

  const build = async () => {
    if (building || !mode) return;
    setBuilding(true);
    try {
      // 1. Create the portal (this also switches the active org).
      await createOrganization(name.trim());

      // 1b. Optionally copy connected tools from another portal (now that the
      // new org is the active one, the copy targets it).
      if (copyFromOrgId) {
        await copyConnections.mutateAsync(copyFromOrgId).catch(() => {
          toast.message("Couldn't copy tools — connect them on the board.");
        });
      }

      // 2. Create the build task.
      const spec: BuildSpec = {
        mode,
        prompt: prompt.trim(),
        visibility,
        ...(mode === "refresh" && sourceUrl.trim()
          ? { sourceUrl: sourceUrl.trim() }
          : {}),
        ...(stackHint ? { stackHint } : {}),
        ...(hostingHint ? { hostingHint } : {}),
      };
      const title =
        mode === "refresh" ? `Refresh: ${name.trim()}` : `Build: ${name.trim()}`;
      const task = await createTask.mutateAsync({
        title: title.slice(0, 200),
        buildSpec: spec,
      });

      // 3. Kick it off immediately, then jump to the task to watch it work.
      await buildTask.mutateAsync(task.id).catch(() => {
        toast.message("Project created — start it from the board.");
      });

      router.push(`/tasks/${task.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't start the project.",
      );
      setBuilding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      {/* Top bar: back + brand, spanning full width */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 pt-safe sm:px-6"
        style={{ minHeight: "calc(3.25rem + env(safe-area-inset-top))" }}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={goBack}
          aria-label="Back"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <span className="font-brand text-sm font-semibold tracking-tight">
          New portal
        </span>
      </header>

      {/* Scrollable content, centered */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 pb-8 pt-6 sm:px-6 sm:pt-10">
          <div className="mb-8">
            <WizardProgress
              current={stepIndex + 1}
              total={NEW_STEPS.length}
            />
          </div>

          {step === "entry" && (
          <StepShell
            title="New portal"
            subtitle="Build something new, or connect what you already have."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <RadioCard
                selected={entry === "new"}
                onSelect={() => setEntry("new")}
                icon={<Sparkles className="size-4" />}
                title="New project"
                description="citshe builds a website or app from nothing."
                hint="With a guide →"
              />
              <RadioCard
                selected={entry === "existing"}
                onSelect={() => setEntry("existing")}
                icon={<GitBranch className="size-4" />}
                title="I already have a repo"
                description="Connect an existing project from GitHub."
                hint="Quick connect →"
              />
            </div>
          </StepShell>
        )}

        {step === "mode" && (
          <StepShell
            title="Starting from a blank page?"
            subtitle="Pick how Claude should begin."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <RadioCard
                selected={mode === "scratch"}
                onSelect={() => setMode("scratch")}
                icon={<Wand2 className="size-4" />}
                title="Completely from scratch"
                description="Describe the idea — Claude designs and builds it."
              />
              <RadioCard
                selected={mode === "refresh"}
                onSelect={() => setMode("refresh")}
                icon={<RefreshCw className="size-4" />}
                title="Refresh an existing site"
                description="Give a URL — Claude looks at it and builds a better version."
              />
            </div>
          </StepShell>
        )}

        {step === "describe" && (
          <StepShell
            title={
              mode === "refresh"
                ? "Which site are we refreshing?"
                : "What do you want to build?"
            }
            subtitle="Claude picks the right tools automatically."
          >
            <div className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="portal-name">Portal name</Label>
                <Input
                  id="portal-name"
                  autoFocus
                  placeholder="e.g. dronexamine.com"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              {mode === "refresh" && (
                <div className="space-y-1.5">
                  <Label htmlFor="source-url">Existing site</Label>
                  <Input
                    id="source-url"
                    type="url"
                    placeholder="https://old-site.com"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                  />
                  <p className="text-[11px] text-text-subtle">
                    Claude will visit it to learn the style and what they do.
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="prompt">
                  {mode === "refresh" ? "What should be better?" : "Describe it"}
                </Label>
                <Textarea
                  id="prompt"
                  rows={6}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={
                    mode === "refresh"
                      ? "See what they do and their style. I want a faster, more modern version — same character, better UX."
                      : "A blog about drone-license exams in Poland. Clean, minimal style like Linear. Guides, categories per country, a newsletter."
                  }
                />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {PROMPT_CHIPS.map((c) => (
                    <Chip
                      key={c}
                      onClick={() =>
                        setPrompt((p) => (p.trim() ? `${p.trim()} ${c}` : c))
                      }
                    >
                      + {c}
                    </Chip>
                  ))}
                </div>
              </div>

              <AdvancedPanel
                open={advancedOpen}
                onToggle={() => setAdvancedOpen((v) => !v)}
                visibility={visibility}
                setVisibility={setVisibility}
                stackHint={stackHint}
                setStackHint={setStackHint}
                hostingHint={hostingHint}
                setHostingHint={setHostingHint}
              />
            </div>
          </StepShell>
        )}

        {step === "connect" && (
          <StepShell
            title="Last thing — access"
            subtitle="citshe needs the accounts it will build your project on. You connect these once."
          >
            <Connectors
              copyFromOrgId={copyFromOrgId}
              onCopyFromChange={setCopyFromOrgId}
            />
            <p className="mt-3 text-xs text-text-subtle">
              GitHub is required. The rest are optional — if a tool is missing
              when Claude needs it, it will ask on the board.
            </p>
          </StepShell>
        )}

        {step === "review" && (
          <StepShell
            title="Ready to build"
            subtitle="Claude will create a repo, build the site, and put it online."
          >
            <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border text-sm">
              <ReviewRow label="Portal" value={name.trim()} />
              <ReviewRow
                label="Mode"
                value={
                  mode === "refresh"
                    ? "New project · refresh"
                    : "New project · from scratch"
                }
              />
              {mode === "refresh" && sourceUrl.trim() && (
                <ReviewRow label="Source" value={sourceUrl.trim()} />
              )}
              <ReviewRow label="Task" value={prompt.trim()} clamp />
              <ReviewRow
                label="Code visibility"
                value={visibility === "public" ? "Open / public" : "Only me"}
              />
            </dl>
          </StepShell>
          )}
        </div>
      </div>

      {/* Footer — full-width bar, content centered to match the body column. */}
      <footer className="shrink-0 border-t border-border bg-background px-4 py-3 pb-safe sm:px-6">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-center gap-3">
          {step === "review" ? (
            <>
              <Button
                variant="ghost"
                onClick={goBack}
                className="flex-1 sm:flex-none"
              >
                Back
              </Button>
              <Button
                variant="primary"
                className="flex-1 sm:flex-none sm:min-w-44"
                onClick={build}
                disabled={building}
              >
                {building ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Rocket className="size-4" />
                )}
                Build project
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={goBack}
                className="flex-1 sm:flex-none"
              >
                Back
              </Button>
              <Button
                variant="primary"
                className="flex-1 sm:flex-none sm:min-w-44"
                onClick={advance}
                disabled={!canContinue()}
              >
                Continue
                <ArrowRight className="size-4" />
              </Button>
            </>
          )}
        </div>
      </footer>

      {/* "I already have a repo" → the plain create-portal dialog. */}
      <CreateOrgDialog open={plainCreateOpen} onOpenChange={setPlainCreateOpen} />
    </div>
  );
}

function StepShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function ReviewRow({
  label,
  value,
  clamp,
}: {
  label: string;
  value: string;
  clamp?: boolean;
}) {
  return (
    <div className="flex gap-4 bg-surface-card px-4 py-3">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={cn("min-w-0 flex-1 text-foreground", clamp && "line-clamp-2")}
      >
        {value}
      </dd>
    </div>
  );
}

function AdvancedPanel({
  open,
  onToggle,
  visibility,
  setVisibility,
  stackHint,
  setStackHint,
  hostingHint,
  setHostingHint,
}: {
  open: boolean;
  onToggle: () => void;
  visibility: RepoVisibility;
  setVisibility: (v: RepoVisibility) => void;
  stackHint: BuildSpec["stackHint"];
  setStackHint: (v: BuildSpec["stackHint"]) => void;
  hostingHint: BuildSpec["hostingHint"];
  setHostingHint: (v: BuildSpec["hostingHint"]) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-muted-foreground transition-linear hover:text-foreground"
      >
        <Settings2 className="size-4" />
        Advanced
        <span className="ml-auto text-xs text-text-subtle">
          {open ? "Hide" : "Optional"}
        </span>
      </button>
      {open && (
        <div className="space-y-5 border-t border-border px-4 py-4">
          <PickRow
            label="Code visibility"
            hint="Who can see the code"
            value={visibility}
            onChange={(v) => setVisibility(v as RepoVisibility)}
            options={[
              { value: "private", label: "Only me" },
              { value: "public", label: "Open / public" },
            ]}
          />
          <PickRow
            label="Stack"
            hint="Let Claude choose, or force one"
            value={stackHint ?? "auto"}
            onChange={(v) =>
              setStackHint(v === "auto" ? undefined : (v as never))
            }
            options={[
              { value: "auto", label: "Auto" },
              { value: "next", label: "Next.js" },
              { value: "astro", label: "Astro" },
              { value: "astro-svelte", label: "Astro + Svelte" },
            ]}
          />
          <PickRow
            label="Hosting"
            hint="Suggested by stack, or force one"
            value={hostingHint ?? "auto"}
            onChange={(v) =>
              setHostingHint(v === "auto" ? undefined : (v as never))
            }
            options={[
              { value: "auto", label: "Auto" },
              { value: "cloudflare", label: "Cloudflare" },
              { value: "vercel", label: "Vercel" },
            ]}
          />
        </div>
      )}
    </div>
  );
}

function PickRow({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-text-subtle">{hint}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Chip
            key={o.value}
            active={value === o.value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
