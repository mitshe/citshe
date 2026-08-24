"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
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
import { useAuthToken } from "@/lib/api/hooks/shared";
import { api } from "@/lib/api/client";
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
type Step = "entry" | "mode" | "describe" | "connect" | "repo" | "review";

const NEW_STEPS: Step[] = [
  "entry",
  "mode",
  "describe",
  "connect",
  "repo",
  "review",
];

/** GitHub-safe repo slug from a portal name (letters/digits/-, lowercased). */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

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
  const { createOrganization, deleteOrganization } = useAuthContext();
  const getToken = useAuthToken();

  // GitHub connected — gates the Connect step (a project needs a repo).
  const [githubConnected, setGithubConnected] = useState(false);

  // ID portalu (nowej org) utworzonego dla tego wizarda. Portal powstaje PUSTY
  // po kroku "describe", żeby connectory (GitHub/Cloudflare/...) podłączać do
  // NIEGO od zera — zero dziedziczenia z innych portali. Gdy user porzuci wizard
  // przed Build, tę pustą org usuwamy (cleanup).
  const [portalOrgId, setPortalOrgId] = useState<string | null>(null);
  const [creatingPortal, setCreatingPortal] = useState(false);
  const [built, setBuilt] = useState(false);

  const [step, setStep] = useState<Step>("entry");
  const [entry, setEntry] = useState<Entry | null>(null);
  const [mode, setMode] = useState<BuildMode | null>(null);

  const [name, setName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [prompt, setPrompt] = useState("");

  // Repo name: suggested from the portal name, editable. `repoEdited` stops the
  // suggestion from overwriting a name the user typed.
  const [repoName, setRepoName] = useState("");
  const [repoEdited, setRepoEdited] = useState(false);
  const suggestedRepo = slugify(name) || "my-project";

  // Advanced (hidden by default; non-technical users never open it).
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [visibility, setVisibility] = useState<RepoVisibility>("private");
  const [stackHint, setStackHint] = useState<BuildSpec["stackHint"]>(undefined);
  const [hostingHint, setHostingHint] =
    useState<BuildSpec["hostingHint"]>(undefined);

  const [building, setBuilding] = useState(false);
  const [buildStep, setBuildStep] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [plainCreateOpen, setPlainCreateOpen] = useState(false);

  const stepIndex = NEW_STEPS.indexOf(step);

  // Sprząta pustą org portalu, jeśli została utworzona a projekt NIE zbudowany.
  const cleanupPortal = async () => {
    if (portalOrgId && !built) {
      await deleteOrganization(portalOrgId).catch(() => undefined);
    }
  };

  const leave = () => {
    void cleanupPortal();
    router.push("/home");
  };

  const goBack = () => {
    if (stepIndex <= 0) {
      leave();
      return;
    }
    // Cofając SPRZED "connect" na "describe" — portal jeszcze niepotrzebny;
    // usuwamy pustą org, żeby ponowne "Continue" utworzyło ją świeżo z aktualną
    // nazwą (i żeby nie zostawić sieroty).
    if (step === "connect" && portalOrgId) {
      void cleanupPortal();
      setPortalOrgId(null);
      setGithubConnected(false);
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
        // GitHub is REQUIRED — the project needs a repo. Block Continue until
        // it's connected (or a portal is picked to reuse it from).
        return githubConnected;
      case "repo": {
        const n = (repoEdited ? repoName : suggestedRepo).trim();
        return n.length > 0 && /^[A-Za-z0-9._-]+$/.test(n);
      }
      default:
        return true;
    }
  };

  const advance = async () => {
    if (step === "entry" && entry === "existing") {
      // "I already have a repo" → the plain create-portal dialog.
      setPlainCreateOpen(true);
      return;
    }

    // Przechodząc z "describe" → "connect": TWORZYMY pusty portal (nową org) i
    // przełączamy na niego, żeby connectory podłączać do NIEGO od zera (nowy JWT
    // z jego orgId). Bez tego connect step pokazywałby connectory starej org.
    if (step === "describe" && !portalOrgId) {
      setCreatingPortal(true);
      try {
        const org = await createOrganization(name.trim());
        setPortalOrgId(org.id);
      } catch {
        setCreatingPortal(false);
        return; // nie przechodź dalej, jeśli nie udało się utworzyć portalu
      }
      setCreatingPortal(false);
    }

    const next = NEW_STEPS[stepIndex + 1];
    if (next) setStep(next);
  };

  const build = async () => {
    if (building || !mode) return;
    setBuilding(true);
    setBuildError(null);
    try {
      const token = await getToken();

      // GATE: don't start anything if the Claude engine isn't logged in — a
      // dead login means the worker can't build. Fail loudly, up-front.
      setBuildStep("Checking the Claude engine…");
      const engine = await api.orchestration.engineStatus(token);
      if (!engine.ok) {
        throw new Error(
          "The Claude engine isn't logged in on the server. An admin needs to " +
            "run `claude /login` once before projects can be built.",
        );
      }

      // Portal (org) JUŻ istnieje — utworzyliśmy go na kroku "describe" i
      // jesteśmy w nim (JWT ma jego orgId). Backend tworzy tylko repo + task
      // w tej org, używając GitHub podłączonego do niej w kroku "connect".
      setBuildStep("Creating your project…");
      const buildSpec: Record<string, unknown> = {
        mode,
        prompt: prompt.trim(),
        visibility,
        ...(mode === "refresh" && sourceUrl.trim()
          ? { sourceUrl: sourceUrl.trim() }
          : {}),
        ...(stackHint ? { stackHint } : {}),
        ...(hostingHint ? { hostingHint } : {}),
      };
      const { taskId } = await api.newProject(
        {
          name: name.trim(),
          repoName: (repoEdited ? repoName : suggestedRepo).trim(),
          buildSpec,
        },
        token,
      );

      // Portal ma teraz repo → NIE jest już "pusty", więc cleanup go nie usunie.
      setBuilt(true);
      setBuildStep("Opening your project…");
      router.push(`/tasks/${taskId}`);
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : "Couldn't start the project.";
      setBuildError(msg);
      setBuildStep(null);
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
        <div className="mx-auto w-full max-w-2xl px-4 pb-12 pt-6 sm:px-6 sm:pt-10">
          <div className="mb-5">
            <WizardProgress current={stepIndex + 1} total={NEW_STEPS.length} />
          </div>

          {/* Nav lives at the TOP (under the progress bar) — you read the step,
              then act right away without hunting for buttons at the bottom. */}
          <div className="mb-8 flex items-center gap-3">
            <Button variant="ghost" onClick={goBack}>
              <ArrowLeft className="size-4" />
              Back
            </Button>
            {step === "review" ? (
              <Button
                variant="primary"
                className="ml-auto min-w-40"
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
            ) : (
              <Button
                variant="primary"
                className="ml-auto min-w-40"
                onClick={() => void advance()}
                disabled={!canContinue() || creatingPortal}
              >
                {creatingPortal ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    Continue
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            )}
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
            <Connectors onGithubStatus={setGithubConnected} />
            {githubConnected ? (
              <p className="mt-3 text-xs text-text-subtle">
                The rest are optional — if a tool is missing when Claude needs
                it, it will ask on the board.
              </p>
            ) : (
              <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-warn">
                <AlertCircle className="size-3.5" />
                Connect GitHub to continue — your project needs a place for its
                code.
              </p>
            )}
          </StepShell>
        )}

        {step === "repo" && (
          <StepShell
            title="Create the repository"
            subtitle="citshe makes a private GitHub repo for your project and Claude builds into it."
          >
            <div className="space-y-2">
              <Label htmlFor="repo-name">Repository name</Label>
              <div className="flex items-center gap-2 rounded-md border border-border bg-surface-inset/50 px-3 focus-within:border-border-strong">
                <span className="shrink-0 text-sm text-text-subtle">
                  github.com/you/
                </span>
                <input
                  id="repo-name"
                  className="min-w-0 flex-1 bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-text-subtle"
                  value={repoEdited ? repoName : suggestedRepo}
                  onChange={(e) => {
                    setRepoEdited(true);
                    setRepoName(e.target.value);
                  }}
                  placeholder="my-project"
                  autoFocus
                />
              </div>
              <p className="text-xs text-text-subtle">
                We suggested one from your portal name — change it or continue.
                {visibility === "public"
                  ? " This repo will be public."
                  : " Private by default."}
              </p>
            </div>
          </StepShell>
        )}

        {step === "review" && (
          <StepShell
            title="Ready to build"
            subtitle="Claude will build the site in your new repo and put it online."
          >
            <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border text-sm">
              <ReviewRow label="Portal" value={name.trim()} />
              <ReviewRow
                label="Repository"
                value={(repoEdited ? repoName : suggestedRepo).trim()}
              />
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

            {/* Live step while building */}
            {building && buildStep && (
              <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-primary/30 bg-primary/[0.04] px-3.5 py-3 text-sm text-foreground">
                <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                {buildStep}
              </div>
            )}

            {/* Hard error — the build stopped, nothing silently proceeded */}
            {buildError && (
              <div className="mt-4 rounded-lg border border-danger/30 bg-danger/[0.05] px-3.5 py-3">
                <p className="text-sm font-medium text-danger">
                  Couldn&apos;t start the build
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {buildError}
                </p>
              </div>
            )}
          </StepShell>
          )}
        </div>
      </div>

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
