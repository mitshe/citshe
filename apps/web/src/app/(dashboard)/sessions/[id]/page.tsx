"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusDot, type StatusDotState } from "@/components/ui/status-dot";
import { EmptyState } from "@/components/ui/empty-state";
import { Kbd } from "@/components/ui/kbd";
import {
  Loader2,
  Play,
  Square,
  ArrowLeft,
  Info,
  Terminal as TerminalIcon,
  PanelLeft,
  X,
  Trash2,
  GitPullRequest,
  AlertCircle,
  Sparkles,
  MoreVertical,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { useQueryClient } from "@tanstack/react-query";
import {
  useSession,
  useCloseTerminal,
  useResumeSession,
  useStopSession,
  useDeleteSession,
  useRecreateSession,
  useUpdateSession,
  useSessionFiles,
  useSessionGitStatus,
  useReadSessionFile,
  useDeleteSessionFile,
  useWriteSessionFile,
  usePushAndCreatePR,
  queryKeys,
} from "@/lib/api/hooks";
import { useSocket } from "@/lib/socket/socket-context";
import { toast } from "sonner";
import type { SessionStatus } from "@/lib/api/types";

import { FileTree } from "./components/file-tree";
import { TerminalView } from "./components/terminal-view";
import { FileEditor } from "./components/file-editor";
import { TabBar, type Tab } from "./components/tab-bar";

const statusLabels: Record<string, string> = {
  CREATING: "Creating",
  RUNNING: "Running",
  PAUSED: "Paused",
  COMPLETED: "Stopped",
  FAILED: "Failed",
};

const statusDotStates: Record<string, StatusDotState> = {
  CREATING: "creating",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "done",
  FAILED: "failed",
};

// NestJS 4xx bodies carry the readable reason in `data.message`; the ApiError's
// own `.message` is only the generic "API Error: 400 …". Prefer the former.
function readableError(err: unknown, fallback: string): string {
  const data = (err as { data?: { message?: unknown } })?.data;
  if (data && typeof data.message === "string") return data.message;
  if (Array.isArray(data?.message) && typeof data.message[0] === "string") {
    return data.message[0];
  }
  if (err instanceof Error && !err.message.startsWith("API Error:")) {
    return err.message;
  }
  return fallback;
}

import { providerLabels } from "@/lib/status-config";

let terminalCounter = 0;

export default function SessionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const queryClient = useQueryClient();
  const { data: session, isLoading, refetch } = useSession(sessionId);
  const { data: files = [], isLoading: filesLoading } = useSessionFiles(sessionId);
  const { data: gitStatuses = [] } = useSessionGitStatus(sessionId);
  const resumeSession = useResumeSession();
  const stopSession = useStopSession();
  const deleteSession = useDeleteSession();
  const recreateSession = useRecreateSession();
  const updateSession = useUpdateSession();
  const closeTerminalMutation = useCloseTerminal();
  const readFile = useReadSessionFile();
  const deleteFile = useDeleteSessionFile();
  const writeFile = useWriteSessionFile();

  // Tab state
  const agentTerminalId = `${sessionId}:agent`;

  // Build agent terminal command from session config
  const buildAgentCmd = useCallback((): string[] => {
    const provider = session?.aiCredential?.provider;
    if (!provider) {
      return ["bash"]; // No AI provider = plain bash
    }

    const args = session.startArguments?.trim() || "";

    // Map provider to CLI command
    let cli: string;
    if (provider === "OPENCLAW") {
      cli = "openclaw tui";
    } else {
      // CLAUDE_CODE_LOCAL and others default to claude
      cli = "claude";
    }

    const fullCmd = args ? `${cli} ${args}` : cli;
    return ["bash", "-c", `${fullCmd} && exec bash`];
  }, [session?.aiCredential?.provider, session?.startArguments]);

  const [tabs, setTabs] = useState<Tab[]>([]);

  // Initialize tabs when session loads
  useEffect(() => {
    if (!session || tabs.length > 0) return;
    const hasAgent = !!session.aiCredentialId;
    const agentTitle = hasAgent
      ? `Agent: ${session.name}`
      : `Terminal: ${session.name}`;
    // Only a terminal tab. The in-app browser preview was removed — it never
    // worked reliably (localhost:PORT refused to connect) and Claude can test
    // in its own container instead.
    const initialTabs: Tab[] = [
      {
        id: agentTerminalId,
        title: agentTitle,
        type: "terminal",
        closeable: true,
        terminalId: agentTerminalId,
        cmd: buildAgentCmd(),
      },
    ];
    setTabs(initialTabs);
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps
  const [activeTabId, setActiveTabId] = useState(agentTerminalId);

  // Inline session-name editing (header)
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [fileContents, setFileContents] = useState<
    Record<string, { content: string | null; loading: boolean }>
  >({});

  // ─── Resizable sidebar ──────────────────────────────────────
  const SIDEBAR_MIN = 160;
  const SIDEBAR_MAX = 480;
  const SIDEBAR_DEFAULT = 240;
  const MAIN_MIN = 300;
  const MOBILE_BREAKPOINT = 768;

  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const isResizing = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Desktop drag-resize
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (isMobile) return;
      e.preventDefault();
      isResizing.current = true;

      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const onMove = (ev: MouseEvent) => {
        if (!isResizing.current) return;
        const containerWidth = containerRef.current?.offsetWidth ?? window.innerWidth;
        let newWidth = startWidth + (ev.clientX - startX);
        newWidth = Math.max(SIDEBAR_MIN, Math.min(newWidth, SIDEBAR_MAX, containerWidth - MAIN_MIN));
        setSidebarWidth(newWidth);
      };

      const onUp = () => {
        isResizing.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [isMobile, sidebarWidth],
  );

  const { socket } = useSocket();

  // Listen for status changes
  useEffect(() => {
    if (!socket || !sessionId) return;

    const handleStatus = (payload: { sessionId: string; status: string }) => {
      if (payload.sessionId === sessionId) refetch();
    };

    socket.on("session:status", handleStatus);
    return () => {
      socket.off("session:status", handleStatus);
    };
  }, [socket, sessionId, refetch]);

  // Fallback polling when session is CREATING
  const currentStatus = session?.status as string | undefined;
  useEffect(() => {
    if (currentStatus !== "CREATING") return;
    const interval = setInterval(() => refetch(), 3000);
    return () => clearInterval(interval);
  }, [currentStatus, refetch]);

  // Refresh open files when terminal has output (agent may have changed files)
  const refreshDebounceRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!socket || !sessionId) return;

    const handleOutput = () => {
      // Debounce: refresh files 2s after last terminal output
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      refreshDebounceRef.current = setTimeout(() => {
        // Refresh all open file tabs
        for (const tab of tabs) {
          if (tab.type === "file" && tab.filePath) {
            const fullPath = `/workspace/${tab.filePath}`;
            readFile
              .mutateAsync({ id: sessionId, path: fullPath })
              .then((result) => {
                setFileContents((prev) => {
                  const current = prev[tab.id];
                  // Only update if content actually changed
                  if (current?.content === result.content) return prev;
                  return {
                    ...prev,
                    [tab.id]: { content: result.content, loading: false },
                  };
                });
              })
              .catch(() => {});
          }
        }
      }, 2000);
    };

    socket.on("session:output", handleOutput);
    return () => {
      socket.off("session:output", handleOutput);
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
    };
  }, [socket, sessionId, tabs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Tab Handlers ──────────────────────────────────────────────

  const handleNewTerminal = useCallback(() => {
    const num = ++terminalCounter;
    const termId = `${sessionId}:term-${Date.now()}`;
    setTabs((prev) => [
      ...prev,
      {
        id: termId,
        title: `Terminal ${num}`,
        type: "terminal",
        closeable: true,
        terminalId: termId,
        cmd: ["bash"],
      },
    ]);
    setActiveTabId(termId);
  }, [sessionId]);

  // Take over: attach to the SAME tmux window the worker's Claude ran in
  // (the "agent" window), so you continue its session, not a fresh one.
  const handleContinueWithClaude = useCallback(() => {
    setActiveTabId(agentTerminalId);
  }, [agentTerminalId]);

  const handleOpenFile = useCallback(
    async (relativePath: string) => {
      const fullPath = `/workspace/${relativePath}`;
      const tabId = `file:${relativePath}`;

      const existing = tabs.find((t) => t.id === tabId);
      if (existing) {
        setActiveTabId(tabId);
        return;
      }

      const fileName = relativePath.split("/").pop() || relativePath;
      setTabs((prev) => [
        ...prev,
        {
          id: tabId,
          title: fileName,
          type: "file",
          filePath: relativePath,
          closeable: true,
        },
      ]);
      setActiveTabId(tabId);

      setFileContents((prev) => ({
        ...prev,
        [tabId]: { content: null, loading: true },
      }));

      try {
        const result = await readFile.mutateAsync({
          id: sessionId,
          path: fullPath,
        });
        setFileContents((prev) => ({
          ...prev,
          [tabId]: { content: result.content, loading: false },
        }));
      } catch {
        setFileContents((prev) => ({
          ...prev,
          [tabId]: { content: null, loading: false },
        }));
      }
    },
    [tabs, sessionId, readFile],
  );

  const handleTabClose = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;

      if (tab.type === "terminal" && tab.terminalId) {
        closeTerminalMutation.mutate({
          sessionId,
          terminalId: tab.terminalId,
        });
      }

      setTabs((prev) => prev.filter((t) => t.id !== tabId));
      setFileContents((prev) => {
        const next = { ...prev };
        delete next[tabId];
        return next;
      });

      if (activeTabId === tabId) {
        // Switch to first available tab
        const remaining = tabs.filter((t) => t.id !== tabId);
        setActiveTabId(remaining[0]?.id || "");
      }
    },
    [tabs, activeTabId, sessionId, closeTerminalMutation],
  );

  const handleCloseOtherTabs = useCallback(
    (keepTabId: string) => {
      const toClose = tabs.filter((t) => t.closeable && t.id !== keepTabId);
      for (const t of toClose) {
        if (t.type === "terminal" && t.terminalId) {
          closeTerminalMutation.mutate({
            sessionId,
            terminalId: t.terminalId,
          });
        }
        setFileContents((prev) => {
          const next = { ...prev };
          delete next[t.id];
          return next;
        });
      }
      setTabs((prev) =>
        prev.filter((t) => !t.closeable || t.id === keepTabId),
      );
      setActiveTabId(keepTabId);
    },
    [tabs, sessionId, closeTerminalMutation],
  );

  const handleCloseAllFileTabs = useCallback(() => {
    const fileTabIds = tabs
      .filter((t) => t.type === "file" && t.closeable)
      .map((t) => t.id);
    setTabs((prev) =>
      prev.filter((t) => t.type !== "file" || !t.closeable),
    );
    setFileContents((prev) => {
      const next = { ...prev };
      for (const id of fileTabIds) delete next[id];
      return next;
    });
    if (fileTabIds.includes(activeTabId)) {
      setActiveTabId(tabs.find((t) => t.type === "terminal")?.id || "");
    }
  }, [tabs, activeTabId]);

  const handleRenameTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;
      const newName = prompt("Rename tab:", tab.title);
      if (newName && newName.trim()) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tabId ? { ...t, title: newName.trim() } : t,
          ),
        );
      }
    },
    [tabs],
  );

  // ─── Keyboard Shortcuts ─────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Prevent browser defaults when focus is in session page
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        // Block browser refresh/replace/find when inside session
        if (["r", "g", "p"].includes(key)) {
          // Only block if not in an input/textarea
          const tag = (e.target as HTMLElement)?.tagName;
          if (tag !== "INPUT" && tag !== "TEXTAREA") {
            e.preventDefault();
          }
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ─── File Operations ───────────────────────────────────────────

  const handleNewFile = useCallback(
    async (dirPath: string) => {
      const name = prompt("New file name:");
      if (!name?.trim()) return;
      const filePath = dirPath === "." ? name : `${dirPath}/${name}`;
      const fullPath = `/workspace/${filePath}`;
      try {
        await writeFile.mutateAsync({
          id: sessionId,
          path: fullPath,
          content: "",
        });
        handleOpenFile(filePath);
      } catch {
        toast.error("Failed to create file");
      }
    },
    [sessionId, writeFile, handleOpenFile],
  );

  const handleNewFolder = useCallback(
    async (dirPath: string) => {
      const name = prompt("New folder name:");
      if (!name?.trim()) return;
      const folderPath = dirPath === "." ? name : `${dirPath}/${name}`;
      const fullPath = `/workspace/${folderPath}`;
      try {
        // Create folder by creating a .gitkeep inside it
        await writeFile.mutateAsync({
          id: sessionId,
          path: `${fullPath}/.gitkeep`,
          content: "",
        });
        toast.success(`Created folder: ${name}`);
      } catch {
        toast.error("Failed to create folder");
      }
    },
    [sessionId, writeFile],
  );

  const handleSaveFile = useCallback(
    (tabId: string, content: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab?.filePath) return;
      writeFile.mutate({
        id: sessionId,
        path: `/workspace/${tab.filePath}`,
        content,
      });
    },
    [tabs, sessionId, writeFile],
  );

  const handleRefreshFile = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab?.filePath) return;
      try {
        const result = await readFile.mutateAsync({
          id: sessionId,
          path: `/workspace/${tab.filePath}`,
        });
        setFileContents((prev) => ({
          ...prev,
          [tabId]: { content: result.content, loading: false },
        }));
      } catch {
        // ignore
      }
    },
    [tabs, sessionId, readFile],
  );

  const handleDeleteFile = useCallback(
    async (relativePath: string) => {
      if (!confirm(`Delete ${relativePath}?`)) return;
      try {
        await deleteFile.mutateAsync({
          id: sessionId,
          path: `/workspace/${relativePath}`,
        });
        handleTabClose(`file:${relativePath}`);
      } catch {
        // ignore
      }
    },
    [sessionId, deleteFile, handleTabClose],
  );

  const handleRenameFile = useCallback(
    async (relativePath: string) => {
      const fileName = relativePath.split("/").pop() || "";
      const newName = prompt("Rename to:", fileName);
      if (!newName || newName === fileName) return;
      const dir = relativePath.substring(
        0,
        relativePath.length - fileName.length,
      );
      const _newPath = `${dir}${newName}`;
      if (!session?.containerId) return;

      try {
        toast.info(`Rename: ${fileName} -> ${newName} (path: ${_newPath})`);
      } catch {
        // ignore
      }
    },
    [session],
  );

  // ─── Session Lifecycle ─────────────────────────────────────────

  const handleResume = async () => {
    try {
      await resumeSession.mutateAsync(sessionId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to resume terminal";
      if (msg.includes("no longer exists") || msg.includes("cannot be recovered")) {
        toast.error("Container was deleted. Create a new terminal instead.");
      } else {
        toast.error(msg);
      }
    }
  };

  const handleStop = async () => {
    try {
      await stopSession.mutateAsync(sessionId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
    } catch {
      toast.error("Failed to stop terminal");
    }
  };

  const pushAndPR = usePushAndCreatePR();

  const handleCreatePR = async () => {
    try {
      const result = await pushAndPR.mutateAsync({
        sessionId,
        data: { title: session?.name },
      });
      toast.success("PR created", {
        description: result.pr.title,
        action: {
          label: "Open",
          onClick: () => window.open(result.pr.webUrl, "_blank"),
        },
      });
    } catch (err) {
      toast.error(readableError(err, "Failed to create PR"));
    }
  };

  const startEditName = () => {
    if (!session) return;
    setNameDraft(session.name);
    setEditingName(true);
  };

  const commitName = async () => {
    const next = nameDraft.trim();
    setEditingName(false);
    if (!next || next === session?.name) return;
    try {
      await updateSession.mutateAsync({ id: sessionId, data: { name: next } });
    } catch {
      toast.error("Failed to rename terminal");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteSession.mutateAsync(sessionId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      toast.success("Terminal deleted");
      router.push("/sessions");
    } catch {
      toast.error("Failed to delete terminal");
    }
  };

  const handleRetry = async () => {
    try {
      await recreateSession.mutateAsync({ id: sessionId, data: {} });
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      await refetch();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to recreate terminal",
      );
    }
  };

  // ─── Render ────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <EmptyState
          icon={<TerminalIcon />}
          title="Terminal not found"
          description="This terminal doesn't exist or was deleted."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/sessions">Back to terminals</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const sessionStatus = session.status as SessionStatus;
  const isRunning = sessionStatus === "RUNNING";
  const isPaused = sessionStatus === "PAUSED";
  const isCompleted = sessionStatus === "COMPLETED";
  const isCreating = sessionStatus === "CREATING";
  const isFailed = sessionStatus === "FAILED";
  const isActive = isRunning || isPaused;
  const hasRepo = !!(session.repositories && session.repositories.length > 0);
  const sessionErrorMessage =
    (session as { errorMessage?: string | null }).errorMessage ||
    "The terminal failed to start.";

  return (
    <div className="flex flex-col absolute inset-0 overflow-hidden">
      {/* Top Bar */}
      <div className="flex h-12 items-center justify-between gap-2 px-2 sm:px-4 border-b border-border bg-surface-card shrink-0 pt-safe">
        <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => router.push("/sessions")}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          {/* Status dot leads the name; the status word moves into the subtitle
              line below so the top row is just the name (no cramped
              "Running · worker: …" competing on one line). */}
          <StatusDot
            state={statusDotStates[sessionStatus] ?? "idle"}
            pulse={isRunning}
            className="shrink-0"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              {editingName ? (
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  className="h-6 w-40 sm:w-56 rounded-sm border border-border bg-surface-inset px-1.5 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              ) : (
                <h1
                  className="font-semibold text-sm truncate cursor-text rounded-sm px-1.5 -mx-1.5 py-0.5 hover:bg-surface-hover transition-linear"
                  title="Click to rename"
                  onClick={startEditName}
                >
                  {session.name}
                </h1>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">
              <span className="text-text-subtle">
                {statusLabels[sessionStatus] || sessionStatus}
              </span>
              {" · "}
              {session.repositories?.[0]?.repository?.name || "No repo"}
              {/* Branch + provider are extra context — only on wider screens so
                  the mobile header line stays short and readable. */}
              <span className="hidden sm:inline">
                {session.branch && ` · ${session.branch}`}
                {session.aiCredential &&
                  ` · ${providerLabels[session.aiCredential.provider] || session.aiCredential.provider}`}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {/* Keyboard shortcuts — desktop only (no keyboard on mobile). */}
          {isRunning && (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="hidden h-8 w-8 sm:flex">
                    <Info className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  className="max-w-xs text-xs space-y-1 p-3"
                >
                  <p className="font-semibold mb-1.5">Keyboard Shortcuts</p>
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 items-center">
                    <Kbd>Ctrl+S</Kbd>
                    <span>Save file</span>
                    <Kbd>Ctrl+F</Kbd>
                    <span>Find in file</span>
                    <Kbd>Ctrl+H</Kbd>
                    <span>Find &amp; Replace</span>
                    <Kbd>Ctrl+G</Kbd>
                    <span>Go to line</span>
                    <Kbd>Ctrl+P</Kbd>
                    <span>Command palette</span>
                    <Kbd>Middle Click</Kbd>
                    <span>Close tab</span>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {/* Primary action stays visible on every screen. */}
          {isRunning && (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={handleContinueWithClaude}
              title="Open an interactive Claude in this session"
            >
              <Sparkles className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Continue with Claude</span>
            </Button>
          )}
          {isCompleted && (
            <Button variant="outline" size="sm" className="h-8" onClick={handleResume} disabled={resumeSession.isPending}>
              {resumeSession.isPending ? (
                <><Loader2 className="w-4 h-4 sm:mr-1 animate-spin" /> <span className="hidden sm:inline">Resuming...</span></>
              ) : (
                <><Play className="w-4 h-4 sm:mr-1" /> <span className="hidden sm:inline">Resume</span></>
              )}
            </Button>
          )}
          {/* A FAILED session can't be resumed (no healthy container) — Retry. */}
          {isFailed && (
            <Button variant="outline" size="sm" className="h-8" onClick={handleRetry} disabled={recreateSession.isPending}>
              {recreateSession.isPending ? (
                <><Loader2 className="w-4 h-4 sm:mr-1 animate-spin" /> <span className="hidden sm:inline">Retrying...</span></>
              ) : (
                <><Play className="w-4 h-4 sm:mr-1" /> <span className="hidden sm:inline">Retry</span></>
              )}
            </Button>
          )}

          {/* Everything secondary lives in one ⋯ menu (same on desktop and
              mobile) so the header stays to just the primary action + ⋯. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isRunning &&
                session?.repositories &&
                session.repositories.length > 0 && (
                  <DropdownMenuItem
                    onClick={handleCreatePR}
                    disabled={pushAndPR.isPending}
                  >
                    <GitPullRequest className="w-4 h-4 mr-2" />
                    Create PR
                  </DropdownMenuItem>
                )}
              {isRunning && (
                <DropdownMenuItem
                  onClick={handleStop}
                  disabled={stopSession.isPending}
                >
                  <Square className="w-4 h-4 mr-2" />
                  Stop
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setDeleteDialogOpen(true)}
                className="text-danger focus:text-danger"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <AlertDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete terminal</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete &quot;{session.name}&quot;? The
                  container and all data will be permanently removed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteSession.isPending}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  // Keep the dialog open while deleting so the pending state is
                  // visible and the button can't be clicked repeatedly.
                  onClick={(e) => {
                    e.preventDefault();
                    void handleDelete();
                  }}
                  disabled={deleteSession.isPending}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deleteSession.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Deleting…
                    </>
                  ) : (
                    "Delete"
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Main Content */}
      <div ref={containerRef} className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Mobile sidebar toggle */}
        {isMobile && !mobileSidebarOpen && (
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="absolute top-2 left-2 z-20 p-1.5 rounded-md bg-surface-card border border-border shadow-sm hover:bg-surface-hover transition-linear"
            title="Show files"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}

        {/* Mobile overlay */}
        {isMobile && mobileSidebarOpen && (
          <div
            className="absolute inset-0 z-30 bg-black/40"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}

        {/* File Browser Sidebar */}
        {isMobile ? (
          <div
            className={`absolute top-0 left-0 z-40 h-full w-64 bg-surface-inset border-r border-border shadow-xl transition-transform duration-200 ${mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <p className="text-[11px] font-medium text-text-subtle uppercase tracking-wider">
                Files
              </p>
              <button
                onClick={() => setMobileSidebarOpen(false)}
                className="p-1 rounded hover:bg-surface-hover"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="h-[calc(100%-37px)]">
              <FileTree
                files={files}
                basePath="/workspace"
                isLoading={filesLoading}
                hasRepo={hasRepo}
                onFileClick={(path) => {
                  handleOpenFile(path);
                  setMobileSidebarOpen(false);
                }}
                onDelete={handleDeleteFile}
                onRename={handleRenameFile}
                onNewFile={handleNewFile}
                onNewFolder={handleNewFolder}
                gitStatuses={gitStatuses}
                hideHeader
              />
            </div>
          </div>
        ) : (
          <>
            <div style={{ width: sidebarWidth }} className="shrink-0 h-full bg-surface-inset">
              <FileTree
                files={files}
                basePath="/workspace"
                isLoading={filesLoading}
                hasRepo={hasRepo}
                onFileClick={handleOpenFile}
                onDelete={handleDeleteFile}
                onRename={handleRenameFile}
                onNewFile={handleNewFile}
                onNewFolder={handleNewFolder}
                gitStatuses={gitStatuses}
              />
            </div>
            {/* Resize handle */}
            <div
              onMouseDown={handleResizeStart}
              className="w-px shrink-0 cursor-col-resize bg-border hover:bg-primary/40 active:bg-primary/60 transition-linear"
            />
          </>
        )}

        {/* Editor / Terminal Area */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Tab Bar */}
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onTabClick={setActiveTabId}
            onTabClose={handleTabClose}
            onCloseOthers={handleCloseOtherTabs}
            onCloseAll={handleCloseAllFileTabs}
            onRename={handleRenameTab}
            onNewTerminal={isRunning ? handleNewTerminal : undefined}
          />

          {/* Tab Content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {/* Terminal tabs */}
            {tabs
              .filter((t) => t.type === "terminal")
              .map((tab) => (
                <div
                  key={tab.id}
                  className="bg-surface-inset"
                  style={{
                    width: "100%",
                    height: "100%",
                    display: activeTabId === tab.id ? "block" : "none",
                  }}
                >
                  {isFailed ? (
                    <div className="flex items-center justify-center h-full p-6 text-muted-foreground">
                      <div className="rounded-lg border border-border bg-surface-card p-6 text-center max-w-md">
                        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-danger/10 text-danger">
                          <AlertCircle className="w-5 h-5" />
                        </div>
                        <p className="text-sm font-medium text-foreground">
                          {sessionErrorMessage}
                        </p>
                        <p className="text-xs mt-2">
                          If this says the executor image is missing, build it
                          with{" "}
                          <code className="bg-surface-inset text-foreground px-1 py-0.5 rounded-sm font-mono">
                            just executor-build
                          </code>
                          .
                        </p>
                        <div className="flex items-center justify-center gap-2 mt-5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleRetry}
                            disabled={recreateSession.isPending}
                          >
                            {recreateSession.isPending ? (
                              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                            ) : (
                              <Play className="w-4 h-4 mr-1" />
                            )}
                            Retry
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={handleDelete}
                            disabled={deleteSession.isPending}
                          >
                            <Trash2 className="w-4 h-4 mr-1" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : isActive ? (
                    <TerminalView
                      sessionId={sessionId}
                      terminalId={tab.terminalId!}
                      isRunning={isRunning}
                      cmd={tab.cmd}
                      isVisible={activeTabId === tab.id}
                    />
                  ) : isCreating ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <div className="rounded-lg border border-border bg-surface-card px-8 py-7 text-center">
                        <StatusDot state="creating" size={22} className="mx-auto mb-4" />
                        <p className="text-sm font-medium text-foreground">Starting container…</p>
                        <p className="text-xs mt-1">Preparing the container environment</p>
                      </div>
                    </div>
                  ) : isCompleted ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <div className="rounded-lg border border-border bg-surface-card px-8 py-7 text-center">
                        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-surface-hover text-muted-foreground">
                          <TerminalIcon className="w-5 h-5" />
                        </div>
                        <p className="text-sm font-medium text-foreground">Terminal stopped</p>
                        <p className="text-xs mt-1">Resume it to pick up where you left off.</p>
                        <div className="flex items-center justify-center mt-5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleResume}
                          >
                            <Play className="w-4 h-4 mr-1" /> Resume
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <div className="rounded-lg border border-border bg-surface-card px-8 py-7 text-center">
                        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-surface-hover text-muted-foreground">
                          <TerminalIcon className="w-5 h-5" />
                        </div>
                        <p className="text-sm font-medium text-foreground">Terminal not running</p>
                        <p className="text-xs mt-1">Start or resume the terminal to use this workspace.</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}

            {/* File tabs */}
            {tabs
              .filter((t) => t.type === "file")
              .map((tab) => (
                <div
                  key={tab.id}
                  style={{
                    width: "100%",
                    height: "100%",
                    display: activeTabId === tab.id ? "block" : "none",
                  }}
                >
                  <FileEditor
                    filePath={tab.filePath || ""}
                    content={fileContents[tab.id]?.content ?? null}
                    isLoading={fileContents[tab.id]?.loading ?? true}
                    onSave={(content) => handleSaveFile(tab.id, content)}
                    onContentRefresh={() => handleRefreshFile(tab.id)}
                  />
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
