"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Sparkles,
  ListPlus,
  Loader2,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Clock,
  KeyRound,
  Terminal,
  MessageCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuthContext } from "@/lib/auth";
import {
  useTasks,
  useCreateTask,
  useProcessTask,
  useAICredentials,
  useSessions,
} from "@/lib/api/hooks";
import { OrgSwitcher } from "@/components/layout/org-switcher";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuickLaunch } from "@/lib/hooks/use-quick-launch";
import type { Task, TaskStatus } from "@citshe/types";

type Mode = "task" | "chat";

const ACTIVE_STATUSES: TaskStatus[] = ["PENDING", "ANALYZING", "IN_PROGRESS", "REVIEW"];

export default function HomePage() {
  const router = useRouter();
  const { currentOrg } = useAuthContext();
  const { data: tasks = [], isLoading: loadingTasks } = useTasks();
  const { data: sessions = [] } = useSessions();
  const { data: credentials = [] } = useAICredentials();
  const createTask = useCreateTask();
  const processTask = useProcessTask();
  const quickLaunch = useQuickLaunch();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [mode, setMode] = useState<Mode>("task");
  const [input, setInput] = useState("");

  const hasCredentials = credentials.length > 0;
  const busy = createTask.isPending || processTask.isPending;

  const runningThreads = useMemo(() => {
    const list = sessions as Array<{ id: string; name: string; status: string }>;
    return list.filter((s) => s.status === "RUNNING" || s.status === "CREATING");
  }, [sessions]);

  const { active, done } = useMemo(() => {
    const list = tasks as Task[];
    return {
      active: list
        .filter((t) => ACTIVE_STATUSES.includes(t.status))
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
      done: list
        .filter((t) => !ACTIVE_STATUSES.includes(t.status))
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
        .slice(0, 5),
    };
  }, [tasks]);

  const greeting =
    new Date().getHours() < 12
      ? "Good morning"
      : new Date().getHours() < 18
        ? "Good afternoon"
        : "Good evening";

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || busy) return;

    if (mode === "chat") {
      router.push(`/chat?prompt=${encodeURIComponent(text)}`);
      return;
    }

    // Task mode: first line is the title, the rest the description.
    const [firstLine, ...rest] = text.split("\n");
    try {
      const task = await createTask.mutateAsync({
        title: firstLine.slice(0, 200),
        description: rest.join("\n").trim() || undefined,
      });
      await processTask.mutateAsync(task.id);
      toast.success("Task delegated — AI is on it");
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delegate task",
      );
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10 space-y-6">
      {/* Portal selector — the org is the portal (mobile only; desktop has it in the sidebar) */}
      <div className="sm:hidden">
        <OrgSwitcher />
      </div>

      <div className="space-y-1">
        <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-foreground/90">
          {greeting}
        </h1>
        <p className="text-sm text-muted-foreground">
          {currentOrg ? (
            <>
              Working on{" "}
              <span className="font-medium text-foreground">{currentOrg.name}</span>
            </>
          ) : (
            "Pick a portal to get started"
          )}
        </p>
      </div>

      {/* Quick launchers — your dev world, from the browser */}
      <div className="grid grid-cols-3 gap-2">
        <TerminalLauncher quickLaunch={quickLaunch} disabled={!hasCredentials} />
        <LauncherCard
          href="/chat"
          icon={<MessageCircle className="h-5 w-5" />}
          title="Chat"
          subtitle="Ask AI"
          accent="text-blue-500"
        />
        <LauncherCard
          onClick={() => {
            setMode("task");
            textareaRef.current?.focus();
          }}
          icon={<ListPlus className="h-5 w-5" />}
          title="Task"
          subtitle="Delegate"
          accent="text-amber-500"
        />
      </div>

      {!hasCredentials ? (
        <MissingCredentials />
      ) : (
        <Composer
          mode={mode}
          setMode={setMode}
          input={input}
          setInput={setInput}
          onSubmit={handleSubmit}
          onKeyDown={handleKeyDown}
          busy={busy}
          textareaRef={textareaRef}
        />
      )}

      {/* Running threads — jump straight back into a live terminal */}
      {runningThreads.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <SectionLabel>Live threads</SectionLabel>
            <Link
              href="/sessions"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              All threads →
            </Link>
          </div>
          <div className="space-y-2">
            {runningThreads.map((s) => (
              <Link
                key={s.id}
                href={`/sessions/${s.id}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-background/50 px-3.5 py-3 hover:bg-muted/40 transition-colors"
              >
                <Terminal className="h-4 w-4 shrink-0 text-emerald-500" />
                <span className="flex-1 truncate text-sm">{s.name}</span>
                <span className="flex items-center gap-1.5 shrink-0 text-[11px] font-medium text-emerald-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {s.status === "CREATING" ? "Starting" : "Live"}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Active tasks */}
      {active.length > 0 && (
        <section className="space-y-2">
          <SectionLabel>In progress</SectionLabel>
          <div className="space-y-2">
            {active.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </div>
        </section>
      )}

      {/* Recently finished */}
      {done.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <SectionLabel>Recently done</SectionLabel>
            <Link
              href="/tasks"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              All tasks →
            </Link>
          </div>
          <div className="space-y-2">
            {done.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </div>
        </section>
      )}

      {!loadingTasks &&
        active.length === 0 &&
        done.length === 0 &&
        runningThreads.length === 0 &&
        hasCredentials && (
          <p className="pt-4 text-center text-sm text-muted-foreground">
            Nothing running yet. Open a terminal or tell AI what to build.
          </p>
        )}
    </div>
  );
}

function TerminalLauncher({
  quickLaunch,
  disabled,
}: {
  quickLaunch: ReturnType<typeof useQuickLaunch>;
  disabled: boolean;
}) {
  const { launch, launching, hasMultipleRepos, repos } = quickLaunch;

  const card = (
    <div
      className={cn(
        "flex flex-col items-center gap-1 rounded-xl border border-border bg-background/50 px-2 py-3.5 text-center transition-colors",
        disabled
          ? "opacity-50"
          : "hover:bg-muted/40 hover:border-primary/30 cursor-pointer",
      )}
    >
      <span className="text-emerald-500">
        {launching ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Terminal className="h-5 w-5" />
        )}
      </span>
      <span className="text-sm font-medium">Terminal</span>
      <span className="text-[11px] text-muted-foreground">Open a thread</span>
    </div>
  );

  // Multiple repos → let the user pick which one to open on.
  if (hasMultipleRepos && !disabled) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={launching}>
          <button className="text-left">{card}</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
            Open terminal on…
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => launch()}>
            <Terminal className="mr-2 h-3.5 w-3.5" />
            Empty terminal
          </DropdownMenuItem>
          {repos.map((r) => (
            <DropdownMenuItem
              key={r.id}
              onClick={() => launch({ repositoryId: r.id })}
            >
              <Terminal className="mr-2 h-3.5 w-3.5 text-emerald-500" />
              <span className="truncate">{r.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <button
      onClick={() => !disabled && launch()}
      disabled={disabled || launching}
      className="text-left"
    >
      {card}
    </button>
  );
}

function LauncherCard({
  href,
  onClick,
  icon,
  title,
  subtitle,
  accent,
}: {
  href?: string;
  onClick?: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  accent: string;
}) {
  const inner = (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-border bg-background/50 px-2 py-3.5 hover:bg-muted/40 hover:border-primary/30 transition-colors text-center">
      <span className={accent}>{icon}</span>
      <span className="text-sm font-medium">{title}</span>
      <span className="text-[11px] text-muted-foreground">{subtitle}</span>
    </div>
  );

  if (href) {
    return <Link href={href}>{inner}</Link>;
  }
  return (
    <button onClick={onClick} className="text-left">
      {inner}
    </button>
  );
}

function Composer({
  mode,
  setMode,
  input,
  setInput,
  onSubmit,
  onKeyDown,
  busy,
  textareaRef,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  input: string;
  setInput: (v: string) => void;
  onSubmit: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  busy: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <div className="rounded-2xl border border-border bg-muted/30 focus-within:border-primary/50 transition-colors overflow-hidden shadow-sm">
      <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
        <ModeTab
          active={mode === "task"}
          onClick={() => setMode("task")}
          icon={<ListPlus className="h-3.5 w-3.5" />}
          label="Delegate a task"
        />
        <ModeTab
          active={mode === "chat"}
          onClick={() => setMode("chat")}
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Ask AI"
        />
      </div>
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          const el = e.target;
          el.style.height = "auto";
          el.style.height = Math.min(el.scrollHeight, 200) + "px";
        }}
        onKeyDown={onKeyDown}
        placeholder={
          mode === "task"
            ? 'What should AI do? e.g. "Add a blog post about the A2 drone exam"'
            : "Ask anything, or plan your next move..."
        }
        className="w-full min-h-[72px] max-h-[200px] resize-none bg-transparent px-4 pt-3 pb-1 text-sm outline-none placeholder:text-muted-foreground overflow-y-auto"
        rows={2}
      />
      <div className="flex items-center justify-between px-3 pb-2.5">
        <span className="text-[11px] text-muted-foreground/70">
          {mode === "task"
            ? "AI clones the repo, makes changes and pushes"
            : "Conversation, no code changes"}
        </span>
        <Button
          size="sm"
          onClick={onSubmit}
          disabled={!input.trim() || busy}
          className="h-8 gap-1.5 rounded-lg"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
          {mode === "task" ? "Delegate" : "Send"}
        </Button>
      </div>
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
      {children}
    </p>
  );
}

const STATUS_META: Record<
  TaskStatus,
  { label: string; icon: React.ReactNode; className: string }
> = {
  PENDING: { label: "Queued", icon: <Clock className="h-3.5 w-3.5" />, className: "text-muted-foreground" },
  ANALYZING: { label: "Analyzing", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, className: "text-blue-500" },
  IN_PROGRESS: { label: "Working", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, className: "text-emerald-500" },
  REVIEW: { label: "In review", icon: <Clock className="h-3.5 w-3.5" />, className: "text-amber-500" },
  COMPLETED: { label: "Done", icon: <CheckCircle2 className="h-3.5 w-3.5" />, className: "text-emerald-500" },
  FAILED: { label: "Failed", icon: <XCircle className="h-3.5 w-3.5" />, className: "text-destructive" },
  CANCELLED: { label: "Cancelled", icon: <XCircle className="h-3.5 w-3.5" />, className: "text-muted-foreground" },
};

function TaskRow({ task }: { task: Task }) {
  const meta = STATUS_META[task.status];
  return (
    <Link
      href={`/tasks/${task.id}`}
      className="flex items-center gap-3 rounded-xl border border-border bg-background/50 px-3.5 py-3 hover:bg-muted/40 transition-colors"
    >
      <span className={cn("shrink-0", meta.className)}>{meta.icon}</span>
      <span className="flex-1 truncate text-sm">{task.title}</span>
      <span className={cn("shrink-0 text-[11px] font-medium", meta.className)}>
        {meta.label}
      </span>
    </Link>
  );
}

function MissingCredentials() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center space-y-3">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
        <KeyRound className="h-6 w-6 text-primary" />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Connect AI for this portal</h2>
        <p className="text-sm text-muted-foreground">
          Add an API key (Claude, OpenAI...) so AI can run tasks and power your
          terminals.
        </p>
      </div>
      <Button asChild size="sm">
        <Link href="/settings/ai">Add AI key</Link>
      </Button>
    </div>
  );
}
