"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Home,
  ListTodo,
  FolderGit2,
  SquareTerminal,
  Blocks,
  Clock,
  Settings,
} from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { StatusDot } from "@/components/ui/status-dot";
import { useTasks, useRepositories, useSessions } from "@/lib/api/hooks";
import type { Task, Repository } from "@citshe/types";

/**
 * Custom event that any part of the app can dispatch to open the palette
 * (e.g. the topbar search button, or Home's search field).
 */
export const OPEN_COMMAND_EVENT = "citshe:open-command";

const PAGES = [
  { label: "Home", href: "/home", icon: Home },
  { label: "Tasks", href: "/tasks", icon: ListTodo },
  { label: "Repos", href: "/repos", icon: FolderGit2 },
  { label: "Terminals", href: "/sessions", icon: SquareTerminal },
  { label: "Schedules", href: "/schedules", icon: Clock },
  { label: "Stack", href: "/stack", icon: Blocks },
  { label: "Settings", href: "/settings", icon: Settings },
];

type SessionRow = { id: string; name: string; status: string };

/**
 * The single, global ⌘K command palette. Consolidates the two previous
 * palettes (components/command-palette.tsx + components/app/command-palette.tsx).
 *
 * - Manages its own open state + ⌘K / Ctrl+K hotkey.
 * - Also opens on a `citshe:open-command` window event.
 * - Mounted ONCE in (dashboard)/layout.tsx.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const { data: tasks = [] } = useTasks();
  const { data: repos = [] } = useRepositories();
  const { data: sessions = [] } = useSessions();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_EVENT, onOpen);
    };
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const taskList = (tasks as Task[]).slice(0, 20);
  const repoList = (repos as Repository[]).slice(0, 20);
  const sessionList = (sessions as SessionRow[]).slice(0, 20);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search"
      description="Search tasks, repos, terminals and pages"
    >
      <CommandInput placeholder="Search tasks, repos, terminals…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        {taskList.length > 0 && (
          <CommandGroup heading="Tasks">
            {taskList.map((t) => (
              <CommandItem
                key={t.id}
                value={`task ${t.title} ${t.id}`}
                onSelect={() => go(`/tasks/${t.id}`)}
              >
                <ListTodo className="text-muted-foreground" />
                <span className="flex-1 truncate">{t.title}</span>
                <span className="font-mono text-[11px] text-text-subtle">
                  {t.id.slice(0, 6)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {repoList.length > 0 && (
          <CommandGroup heading="Repos">
            {repoList.map((r) => (
              <CommandItem
                key={r.id}
                value={`repo ${r.name} ${r.fullPath}`}
                onSelect={() => go("/repos")}
              >
                <FolderGit2 className="text-muted-foreground" />
                <span className="flex-1 truncate">{r.name}</span>
                <span className="truncate font-mono text-[11px] text-text-subtle">
                  {r.fullPath}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {sessionList.length > 0 && (
          <CommandGroup heading="Terminals">
            {sessionList.map((s) => {
              const isRunning = s.status === "RUNNING";
              const isCreating = s.status === "CREATING";
              return (
                <CommandItem
                  key={s.id}
                  value={`terminal ${s.name} ${s.id}`}
                  onSelect={() => go(`/sessions/${s.id}`)}
                >
                  {isRunning || isCreating ? (
                    <StatusDot state={isCreating ? "creating" : "running"} />
                  ) : (
                    <SquareTerminal className="text-muted-foreground" />
                  )}
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="font-mono text-[11px] text-text-subtle">
                    {s.id.slice(0, 6)}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        <CommandGroup heading="Pages">
          {PAGES.map((p) => (
            <CommandItem
              key={p.href}
              value={`page ${p.label}`}
              onSelect={() => go(p.href)}
            >
              <p.icon />
              <span>{p.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
