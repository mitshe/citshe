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
  X,
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
import { useAuthContext } from "@/lib/auth";
import { useCreateTask, useBuildTask } from "@/lib/api/hooks/tasks";
import { Connectors } from "./connectors";
import type {
  BuildMode,
  BuildSpec,
  RepoVisibility,
} from "@citshe/types";

/**
 * The "New portal" wizard. One entry, branching into:
 *   entry:    new project (guided)  |  existing repo (skip → plain create)
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

export function NewPortalWizard({
  open,
  onClose,
  onSkipToPlain,
}: {
  open: boolean;
  onClose: () => void;
  /** "Existing repo" path → hand off to the plain create-portal dialog. */
  onSkipToPlain: () => void;
}) {
  const router = useRouter();
  const { createOrganization } = useAuthContext();
  const createTask = useCreateTask();
  const buildTask = useBuildTask();

  const [step, setStep] = useState<Step>("entry");
  const [entry, setEntry] = useState<Entry | null>(null);
  const [mode, setMode] = useState<BuildMode | null>(null);

  const [name, setName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [prompt, setPrompt] = useState("");

  // Advanced (hidden by default; non-technical users never open it).
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [visibility, setVisibility] = useState<RepoVisibility>("private");
  const [stackHint, setStackHint] =
    useState<BuildSpec["stackHint"]>(undefined);
  const [hostingHint, setHostingHint] =
    useState<BuildSpec["hostingHint"]>(undefined);

  const [building, setBuilding] = useState(false);

  const reset = () => {
    setStep("entry");
    setEntry(null);
    setMode(null);
    setName("");
    setSourceUrl("");
    setPrompt("");
    setAdvancedOpen(false);
    setVisibility("private");
    setStackHint(undefined);
    setHostingHint(undefined);
    setBuilding(false);
  };

  const close = () => {
    if (building) return;
    reset();
    onClose();
  };

  const stepIndex = NEW_STEPS.indexOf(step);

  const goBack = () => {
    if (stepIndex <= 0) {
      close();
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
      // Hand off to the plain "connect existing repo" dialog.
      reset();
      onSkipToPlain();
      return;
    }
    const next = NEW_STEPS[stepIndex + 1];
    if (next) setStep(next);
  };

  const build = async () => {
    if (building) return;
    if (!mode) return;
    setBuilding(true);
    try {
      // 1. Create the portal (this also switches the active org).
      await createOrganization(name.trim());

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
        mode === "refresh"
          ? `Refresh: ${name.trim()}`
          : `Build: ${name.trim()}`;
      const task = await createTask.mutateAsync({
        title: title.slice(0, 200),
        buildSpec: spec,
      });

      // 3. Kick it off immediately, then jump to the task to watch it work.
      await buildTask.mutateAsync(task.id).catch(() => {
        // Non-fatal: the task exists; the user can start it from the board.
        toast.message("Project created — start it from the board.");
      });

      reset();
      onClose();
      router.push(`/tasks/${task.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't start the project.",
      );
      setBuilding(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 sm:items-center sm:p-4">
      <div className="flex w-full flex-col bg-surface-card sm:max-w-2xl sm:rounded-lg sm:border sm:border-border sm:shadow-2xl">
        {/* Header */}
        <div
          className="flex items-center gap-3 border-b border-border px-4 pt-safe sm:pt-4"
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
          <div className="ml-auto">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={close}
              disabled={building}
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Progress */}
        <div className="border-b border-border px-4 py-3 sm:px-6">
          <WizardProgress current={stepIndex + 1} total={NEW_STEPS.length} />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
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
              <div className="space-y-4">
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
                    {mode === "refresh"
                      ? "What should be better?"
                      : "Describe it"}
                  </Label>
                  <Textarea
                    id="prompt"
                    rows={5}
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
                          setPrompt((p) =>
                            p.trim() ? `${p.trim()} ${c}` : c,
                          )
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
              <Connectors />
              <p className="mt-3 text-xs text-text-subtle">
                GitHub is required. The rest are optional — if a tool is
                missing when Claude needs it, it will ask on the board.
              </p>
            </StepShell>
          )}

          {step === "review" && (
            <StepShell
              title="Ready to build"
              subtitle="Claude will create a repo, build the site, and put it online."
            >
              <dl className="divide-y divide-border rounded-lg border border-border text-sm">
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

        {/* Footer CTA */}
        <div className="flex flex-col gap-2 border-t border-border bg-surface-inset/40 p-4 pb-safe sm:px-6">
          {step === "review" ? (
            <>
              <Button
                variant="primary"
                className="w-full"
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
              <p className="text-center text-[11px] text-text-subtle">
                You&apos;ll watch the progress on the board.
              </p>
            </>
          ) : (
            <Button
              variant="primary"
              className="w-full"
              onClick={advance}
              disabled={!canContinue()}
            >
              Continue
              <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
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
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        )}
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
    <div className="flex gap-4 px-3.5 py-2.5">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 flex-1 text-foreground",
          clamp && "line-clamp-2",
        )}
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
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-sm font-medium text-muted-foreground transition-linear hover:text-foreground"
      >
        <Settings2 className="size-4" />
        Advanced
        <span className="ml-auto text-xs text-text-subtle">
          {open ? "Hide" : "Optional"}
        </span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-border px-3.5 py-3">
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
    <div className="space-y-1.5">
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
