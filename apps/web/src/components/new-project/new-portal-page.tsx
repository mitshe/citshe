"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Rocket,
  Settings2,
  Sparkles,
  Wand2,
  Globe,
  LayoutDashboard,
  Server,
  Database,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Chip } from "@/components/ui/chip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusDot } from "@/components/ui/status-dot";
import { WizardProgress } from "@/components/ui/wizard-progress";
import { useAuthContext } from "@/lib/auth";
import { useAuthToken } from "@/lib/api/hooks/shared";
import { api } from "@/lib/api/client";
import type {
  BuildMode,
  BuildSpec,
  ProjectType,
  RepoVisibility,
} from "@citshe/types";

/**
 * The "New portal" flow, rendered as a full page (route: /new-portal).
 *
 * Model (deliberately dead-simple, zero fetching):
 *   mode → describe → access → repo → review → Build
 *
 * (An "existing repo" entry point is planned; until it ships the flow only
 * builds new projects, so we don't gate the user behind a one-option chooser.)
 *
 * The "access" step is just EMPTY key inputs — the wizard never asks the API
 * "what's connected", because a new portal has nothing and inherits nothing.
 * You paste GitHub (required) + optionally Cloudflare/Vercel/Neon. On Build, ONE
 * atomic backend call creates the portal, saves those keys to it, creates the
 * repo, and starts the build — all-or-nothing, so a failure leaves no orphan.
 */

type Step = "type" | "describe" | "access" | "repo" | "review";

const NEW_STEPS: Step[] = ["type", "describe", "access", "repo", "review"];

/** GitHub-safe repo slug from a portal name (letters/digits/-, lowercased). */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

/** The kinds of project the wizard can start. Drives the builder's recipe. */
const PROJECT_TYPES: {
  type: ProjectType;
  name: string;
  description: string;
  icon: React.ReactNode;
  /** Placeholder for the "describe" step, tailored to the type. */
  placeholder: string;
}[] = [
  {
    type: "website",
    name: "Website",
    description: "A landing page, blog or content site.",
    icon: <Globe className="size-4" />,
    placeholder:
      "A blog about drone-license exams in Poland. Clean, minimal, guides per country, a newsletter.",
  },
  {
    type: "webapp",
    name: "Web app",
    description: "An app with login, dashboards, dynamic data.",
    icon: <LayoutDashboard className="size-4" />,
    placeholder:
      "A habit tracker with email login, a dashboard of streaks, and a weekly summary.",
  },
  {
    type: "api",
    name: "API",
    description: "An HTTP backend / service with endpoints.",
    icon: <Server className="size-4" />,
    placeholder:
      "A REST API that stores short notes: create, list, delete. JSON in/out.",
  },
  {
    type: "scraper",
    name: "Scraper",
    description: "Pulls data on a schedule into a database.",
    icon: <Database className="size-4" />,
    placeholder:
      "Scrape new listings from example.com every hour into a Postgres table (title, price, url).",
  },
  {
    type: "worker",
    name: "Scheduled job",
    description: "A recurring action that runs on a cron.",
    icon: <Clock className="size-4" />,
    placeholder:
      "Every morning at 8:00, fetch yesterday's signups and post a summary to a webhook.",
  },
];

const PROMPT_CHIPS = [
  "content blog",
  "landing page",
  "app with login",
  "online store",
  "dark theme",
  "in Polish",
];

/**
 * Style starters — clicking one appends a concrete visual brief to the
 * description, so a non-designer doesn't have to find the words. Pure text; no
 * backend. The `add` string is written as a sentence the build can act on.
 */
const STYLE_TEMPLATES: { label: string; add: string }[] = [
  {
    label: "Minimal / Linear",
    add: "Clean, minimal, modern — lots of whitespace, thin borders, a single accent color, crisp sans-serif type. Understated like Linear or Vercel.",
  },
  {
    label: "Bold & colorful",
    add: "Bold and colorful — big confident headings, vivid gradients or accent colors, playful shapes, high energy.",
  },
  {
    label: "Editorial / blog",
    add: "Editorial and content-first — comfortable reading typography, clear article layout, generous line spacing, magazine feel.",
  },
  {
    label: "Dark & sleek",
    add: "Dark theme by default — near-black background, subtle glows, high contrast, premium and sleek.",
  },
  {
    label: "Warm & friendly",
    add: "Warm and friendly — soft rounded corners, gentle colors, approachable tone, a little personality.",
  },
  {
    label: "Corporate / trust",
    add: "Professional and trustworthy — calm blues/greys, structured layout, clear sections, corporate and credible.",
  },
];

/** The connectable tools, each a single key to paste (nothing is fetched). */
interface KeyField {
  key: "github" | "cloudflare" | "vercel" | "neon";
  name: string;
  purpose: string;
  required?: boolean;
  label: string;
  docsUrl: string;
  guide: string;
}

const KEY_FIELDS: KeyField[] = [
  {
    key: "github",
    name: "GitHub",
    purpose: "Where your project's code lives",
    required: true,
    label: "Personal access token",
    docsUrl: "https://github.com/settings/tokens/new",
    guide: 'github.com/settings/tokens (classic) → scopes "repo" + "workflow".',
  },
  {
    key: "cloudflare",
    name: "Cloudflare",
    purpose: "Hosting for websites",
    label: "API token",
    docsUrl: "https://dash.cloudflare.com/profile/api-tokens",
    // Deploying to Pages needs the ACCOUNT-level Cloudflare Pages permission —
    // a zone-only (DNS) token connects but then fails at deploy time.
    guide:
      'dash.cloudflare.com/profile/api-tokens → "Create Custom Token" → add Account · Cloudflare Pages · Edit (a zone-only token won\'t deploy).',
  },
  {
    key: "vercel",
    name: "Vercel",
    purpose: "Hosting for apps",
    label: "Token",
    docsUrl: "https://vercel.com/account/tokens",
    guide: "vercel.com/account/tokens → Create Token.",
  },
  {
    key: "neon",
    name: "Neon",
    purpose: "Database (when the project needs one)",
    label: "API key",
    docsUrl: "https://console.neon.tech/app/settings/api-keys",
    guide: "console.neon.tech/app/settings/api-keys → Create new API key.",
  },
];

export type AccessKeys = Partial<Record<KeyField["key"], string>>;

export function NewPortalPage() {
  const router = useRouter();
  const { switchOrganization } = useAuthContext();
  const getToken = useAuthToken();

  const [step, setStep] = useState<Step>("type");
  // Defaults to "website"; the dropdown always shows a valid selection.
  const [projectType, setProjectType] = useState<ProjectType>("website");
  // scratch/refresh only applies to a website; default scratch for everything.
  const [mode, setMode] = useState<BuildMode>("scratch");

  const [name, setName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [prompt, setPrompt] = useState("");

  // Access keys — always start empty, typed fresh, saved to the new portal on
  // Build. NOTHING is fetched here.
  const [keys, setKeys] = useState<AccessKeys>({});

  // Repo name: suggested from the portal name, editable.
  const [repoName, setRepoName] = useState("");
  const [repoEdited, setRepoEdited] = useState(false);
  const suggestedRepo = slugify(name) || "my-project";

  // Advanced (hidden by default).
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [visibility, setVisibility] = useState<RepoVisibility>("private");
  const [stackHint, setStackHint] = useState<BuildSpec["stackHint"]>(undefined);
  const [hostingHint, setHostingHint] =
    useState<BuildSpec["hostingHint"]>(undefined);

  const [building, setBuilding] = useState(false);
  const [buildStep, setBuildStep] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  // "Improve with AI" on the description box.
  const [improving, setImproving] = useState(false);
  const [improveError, setImproveError] = useState<string | null>(null);

  const stepIndex = NEW_STEPS.indexOf(step);

  const addStyle = (add: string) =>
    setPrompt((p) => (p.trim() ? `${p.trim()}\n\n${add}` : add));

  const improveWithAI = async () => {
    if (improving || !prompt.trim()) return;
    setImproving(true);
    setImproveError(null);
    try {
      const token = await getToken();
      const { description } = await api.newProjectImproveDescription(
        prompt.trim(),
        token,
      );
      if (description) setPrompt(description);
    } catch (err) {
      setImproveError(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't improve the description.",
      );
    } finally {
      setImproving(false);
    }
  };

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
      case "type":
        return true;
      case "describe":
        return (
          name.trim().length > 0 &&
          prompt.trim().length > 0 &&
          (mode !== "refresh" || isValidUrl(sourceUrl))
        );
      case "access":
        // GitHub is REQUIRED — the project needs a repo. Others are optional.
        return !!keys.github?.trim();
      case "repo": {
        const n = (repoEdited ? repoName : suggestedRepo).trim();
        return n.length > 0 && /^[A-Za-z0-9._-]+$/.test(n);
      }
      default:
        return true;
    }
  };

  const advance = () => {
    // Keys are validated inline by each ConnectBlock, so a set key is already a
    // GOOD key — no re-check needed here.
    const next = NEW_STEPS[stepIndex + 1];
    if (next) setStep(next);
  };

  const build = async () => {
    if (building) return;
    setBuilding(true);
    setBuildError(null);
    try {
      const token = await getToken();

      // GATE: don't start if the Claude engine isn't logged in on the server.
      setBuildStep("Checking the Claude engine…");
      const engine = await api.orchestration.engineStatus(token);
      if (!engine.ok) {
        throw new Error(
          engine.reason === "unknown"
            ? "We couldn't reach the build engine right now. Please try again in a moment."
            : "The build engine needs to be reconnected before new sites can be built. Please contact the person who set up citshe.",
        );
      }

      // ONE atomic call: create the portal, save the keys to it, create the
      // repo, and the build task — all-or-nothing (no orphan portals).
      setBuildStep("Creating your project…");
      const buildSpec: Record<string, unknown> = {
        mode,
        projectType,
        prompt: prompt.trim(),
        visibility,
        ...(mode === "refresh" && sourceUrl.trim()
          ? { sourceUrl: sourceUrl.trim() }
          : {}),
        ...(stackHint ? { stackHint } : {}),
        ...(hostingHint ? { hostingHint } : {}),
      };
      const cleanKeys: AccessKeys = {};
      for (const f of KEY_FIELDS) {
        const v = keys[f.key]?.trim();
        if (v) cleanKeys[f.key] = v;
      }
      const { organizationId, taskId } = await api.newProject(
        {
          name: name.trim(),
          repoName: (repoEdited ? repoName : suggestedRepo).trim(),
          keys: cleanKeys,
          buildSpec,
        },
        token,
      );

      // Switch the panel to the new portal, then land on Home — the BuildHero
      // there shows the friendly "Building your project… → Your site is live"
      // payoff, instead of dumping the user on the developer task view.
      setBuildStep("Opening your project…");
      await switchOrganization(organizationId).catch(() => undefined);
      void taskId; // the hero finds the active build task on Home
      router.push("/home");
    } catch (err) {
      setBuildError(humanizeBuildError(err));
      setBuildStep(null);
      setBuilding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      {/* Top bar */}
      <header
        className="flex shrink-0 items-center gap-3 border-b border-border px-4 pt-safe sm:px-6"
        style={{ minHeight: "calc(3.25rem + env(safe-area-inset-top))" }}
      >
        <Button variant="ghost" size="icon-sm" onClick={goBack} aria-label="Back">
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

          {/* Nav at the TOP */}
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
                onClick={advance}
                disabled={!canContinue()}
              >
                Continue
                <ArrowRight className="size-4" />
              </Button>
            )}
          </div>

          {step === "type" && (
            <StepShell
              title="What are you building?"
              subtitle="Pick the kind of project — Claude uses the right stack and setup for it."
            >
              <div className="space-y-2">
                <Label htmlFor="project-type">Project type</Label>
                <Select
                  value={projectType}
                  onValueChange={(v) => {
                    const type = v as ProjectType;
                    setProjectType(type);
                    // Refresh only makes sense for a website.
                    if (type !== "website") setMode("scratch");
                  }}
                >
                  <SelectTrigger id="project-type" className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_TYPES.map((t) => (
                      <SelectItem key={t.type} value={t.type}>
                        <span className="flex items-center gap-2.5">
                          <span className="text-muted-foreground">
                            {t.icon}
                          </span>
                          {t.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="pt-0.5 text-sm text-muted-foreground">
                  {
                    PROJECT_TYPES.find((t) => t.type === projectType)
                      ?.description
                  }
                </p>

                {/* Website-only: build new vs refresh an existing site. */}
                {projectType === "website" && (
                  <div className="space-y-2 pt-3">
                    <Label htmlFor="build-mode">Build</Label>
                    <Select
                      value={mode}
                      onValueChange={(v) => setMode(v as BuildMode)}
                    >
                      <SelectTrigger id="build-mode" className="h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="scratch">
                          <span className="flex items-center gap-2.5">
                            <Wand2 className="size-4 text-muted-foreground" />
                            New site
                          </span>
                        </SelectItem>
                        <SelectItem value="refresh">
                          <span className="flex items-center gap-2.5">
                            <RefreshCw className="size-4 text-muted-foreground" />
                            Refresh an existing site
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="pt-0.5 text-sm text-muted-foreground">
                      {mode === "refresh"
                        ? "Point Claude at a live site and it builds a fresh, better version."
                        : "Claude builds a brand-new site from your description."}
                    </p>
                  </div>
                )}
              </div>
            </StepShell>
          )}

          {step === "describe" && (
            <StepShell
              title={
                mode === "refresh"
                  ? "Which site are we refreshing?"
                  : "Describe your project"
              }
              subtitle="Claude picks the right stack and setup automatically."
            >
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor="portal-name">Project name</Label>
                  <Input
                    id="portal-name"
                    placeholder="e.g. My drone-exam blog"
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
                    <p className="text-xs text-text-subtle">
                      Claude will visit it to learn the style and what they do.
                    </p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="prompt">
                      {mode === "refresh"
                        ? "What should be better?"
                        : "Describe it"}
                    </Label>
                    <button
                      type="button"
                      onClick={() => void improveWithAI()}
                      disabled={improving || !prompt.trim()}
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-primary transition-linear hover:bg-primary/[0.08] disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      {improving ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="size-3.5" />
                      )}
                      Improve with AI
                    </button>
                  </div>
                  <Textarea
                    id="prompt"
                    rows={6}
                    value={prompt}
                    onChange={(e) => {
                      setPrompt(e.target.value);
                      if (improveError) setImproveError(null);
                    }}
                    placeholder={
                      mode === "refresh"
                        ? "See what they do and their style. I want a faster, more modern version — same character, better UX."
                        : (PROJECT_TYPES.find((t) => t.type === projectType)
                            ?.placeholder ??
                          "Describe what you want built…")
                    }
                  />
                  {improveError && (
                    <p className="flex items-start gap-1.5 text-xs font-medium text-danger">
                      <AlertCircle className="mt-px size-3.5 shrink-0" />
                      {improveError}
                    </p>
                  )}
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

                  {/* Style starters only matter for things with a UI. */}
                  {(projectType === "website" ||
                    projectType === "webapp") && (
                    <div className="pt-2">
                      <p className="mb-1.5 text-xs font-medium text-text-subtle">
                        Style
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {STYLE_TEMPLATES.map((s) => (
                          <Chip key={s.label} onClick={() => addStyle(s.add)}>
                            {s.label}
                          </Chip>
                        ))}
                      </div>
                    </div>
                  )}
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

          {step === "access" && (
            <StepShell
              title="Connect your accounts"
              subtitle="GitHub is required — it's where your code lives. Connect a host so Claude can put the site online; add a database only if the project needs one."
            >
              <div className="space-y-2.5">
                {KEY_FIELDS.map((f) => (
                  <ConnectBlock
                    key={f.key}
                    def={f}
                    value={keys[f.key] ?? ""}
                    getToken={getToken}
                    onChange={(v) =>
                      setKeys((prev) => ({ ...prev, [f.key]: v }))
                    }
                  />
                ))}
              </div>
              <p className="mt-3 text-xs text-text-subtle">
                Keys are encrypted and used only for this project. You can change
                them later in the portal.
              </p>
            </StepShell>
          )}

          {step === "repo" && (
            <StepShell
              title="Create the repository"
              subtitle="citshe makes a GitHub repo for your project and Claude builds into it."
            >
              <div className="space-y-2">
                <Label htmlFor="repo-name">Repository name</Label>
                <div className="flex items-center gap-2 rounded-md border border-border bg-surface-inset px-3 transition-linear focus-within:border-ring focus-within:ring-2 focus-within:ring-ring">
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
                  />
                </div>
                <p className="text-xs text-text-subtle">
                  We suggested one from your project name — change it or continue.
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
                  label="Tools"
                  value={
                    KEY_FIELDS.filter((f) => keys[f.key]?.trim())
                      .map((f) => f.name)
                      .join(" · ") || "GitHub"
                  }
                />
                <ReviewRow
                  label="Code visibility"
                  value={visibility === "public" ? "Open / public" : "Only me"}
                />
              </dl>

              {building && buildStep && (
                <div className="mt-4 rounded-lg border border-primary/30 bg-primary/[0.06] px-3.5 py-3">
                  <div className="flex items-center gap-2.5 text-sm text-foreground">
                    <StatusDot state="running" size={8} pulse />
                    {buildStep}
                  </div>
                  <p className="mt-1.5 pl-[18px] text-xs text-text-subtle">
                    This usually takes a few minutes — you can leave this
                    screen, we&apos;ll keep building.
                  </p>
                </div>
              )}

              {buildError && (
                <div className="mt-4 rounded-lg border border-danger/30 bg-danger/[0.05] px-3.5 py-3">
                  <p className="text-sm font-medium text-danger">
                    Couldn&apos;t start the build
                  </p>
                  <p className="mt-1 text-sm text-text-subtle">{buildError}</p>
                </div>
              )}
            </StepShell>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One collapsible "connect a service" block. Collapsed it's a tidy row (icon-ish
 * dot · name · status · Connect); expanded it takes the key, validates it inline
 * (spinner → ✓ Connected / clear error), then collapses to a connected state.
 * This scales cleanly to many integrations instead of a wall of always-open
 * password inputs. The key is only lifted up (onChange) once it VALIDATES, so a
 * set key is always a good key.
 */
function ConnectBlock({
  def,
  value,
  getToken,
  onChange,
}: {
  def: KeyField;
  value: string;
  getToken: () => Promise<string | undefined>;
  onChange: (v: string) => void;
}) {
  const connected = !!value.trim();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const validate = async () => {
    const k = draft.trim();
    if (!k) return;
    setChecking(true);
    setError(null);
    setWarning(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in.");
      if (def.key === "github") {
        const v = await api.newProjectValidateGithub(k, token);
        if (!v.ok) {
          setError(v.error ?? "That token didn't work.");
          return;
        }
        if (v.warning) setWarning(v.warning);
      } else {
        const v = await api.newProjectValidateKey(def.key, k, token);
        if (!v.ok) {
          setError(v.error ?? "That key didn't work.");
          return;
        }
      }
      // Validated → lift it up and collapse to the connected state.
      onChange(k);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't verify the key.");
    } finally {
      setChecking(false);
    }
  };

  const disconnect = () => {
    onChange("");
    setDraft("");
    setError(null);
    setWarning(null);
    setOpen(false);
  };

  return (
    <div className="rounded-lg border border-border bg-surface-card">
      {/* Header row — always visible. */}
      <div className="flex items-center gap-3 px-3.5 py-3">
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            connected ? "bg-ok" : "bg-text-subtle/40",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {def.name}
            </span>
            {def.required && !connected && (
              <span className="rounded bg-surface-inset px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-subtle">
                required
              </span>
            )}
          </div>
          <p className="truncate text-xs text-text-subtle">
            {connected ? "Connected" : def.purpose}
          </p>
        </div>
        {connected ? (
          <button
            type="button"
            onClick={disconnect}
            className="shrink-0 text-xs font-medium text-text-subtle transition-linear hover:text-danger"
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-linear hover:bg-surface-hover"
          >
            {open ? "Cancel" : "Connect"}
          </button>
        )}
      </div>

      {/* Expanded key entry. */}
      {open && !connected && (
        <div className="space-y-2 border-t border-border px-3.5 py-3">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`key-${def.key}`} className="text-xs">
              {def.label}
            </Label>
            <a
              href={def.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-linear hover:underline"
            >
              How to get it <ExternalLink className="size-3" />
            </a>
          </div>
          <div className="flex gap-2">
            <Input
              id={`key-${def.key}`}
              type="password"
              autoComplete="off"
              autoFocus
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void validate();
              }}
              placeholder={`Paste your ${def.name} ${def.label.toLowerCase()}`}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => void validate()}
              disabled={!draft.trim() || checking}
            >
              {checking ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                "Connect"
              )}
            </Button>
          </div>
          <p className="text-xs text-text-subtle">{def.guide}</p>
          {error && (
            <p className="flex items-start gap-1.5 text-xs font-medium text-danger">
              <AlertCircle className="mt-px size-3.5 shrink-0" />
              {error}
            </p>
          )}
        </div>
      )}

      {/* Non-blocking heads-up (e.g. GitHub missing workflow scope). */}
      {connected && warning && (
        <p className="flex items-start gap-1.5 border-t border-border px-3.5 py-2 text-xs font-medium text-warn">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          {warning}
        </p>
      )}
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

/**
 * Turn whatever the build threw into one clean sentence for the user. The API
 * already returns human messages for the cases the user can act on (bad token,
 * name taken, name collision); we keep those verbatim. We only rewrite the two
 * shapes that would otherwise leak: a network failure (no server message) and a
 * raw "API Error: 500 …" fallback.
 */
function humanizeBuildError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  if (!msg) {
    return "Something went wrong. Nothing was saved — please try again.";
  }
  // fetch() rejects with "Failed to fetch" / "Load failed" when offline.
  if (/failed to fetch|load failed|networkerror/i.test(msg)) {
    return "Couldn't reach citshe. Check your connection and try again.";
  }
  // Unmapped 5xx fallback from the API client — don't show the raw status line.
  if (/^API Error: 5\d\d/.test(msg)) {
    return "The server hit an unexpected error. Nothing was saved — please try again.";
  }
  return msg;
}
