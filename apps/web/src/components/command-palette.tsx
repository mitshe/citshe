"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Home,
  ListPlus,
  FolderGit2,
  Terminal,
  Blocks,
  Settings,
  ListTodo,
} from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useTasks, useRepositories, useSessions } from "@/lib/api/hooks";
import type { Task, Repository } from "@citshe/types";

/** Custom event the Home search button (and anyone else) can dispatch to open the palette. */
export const OPEN_COMMAND_EVENT = "citshe:open-command";

const PAGES = [
  { label: "Home", href: "/home", icon: Home },
  { label: "Tasks", href: "/tasks", icon: ListTodo },
  { label: "Repos", href: "/repos", icon: FolderGit2 },
  { label: "Terminals", href: "/sessions", icon: Terminal },
  { label: "Stack", href: "/stack", icon: Blocks },
  { label: "Settings", href: "/settings", icon: Settings },
];

/**
 * Global ⌘K command palette. Manages its own open state + hotkey, so it can be
 * mounted once in the dashboard layout and reached from anywhere:
 *  - ⌘K / Ctrl+K toggles it
 *  - a `citshe:open-command` window event opens it (Home's search button uses this)
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const { data: tasks = [] } = useTasks();
  const { data: repos = [] } = useRepositories();
  const { data: sessions = [] } = useSessions();

  // Hotkey + custom open event.
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
  const sessionList = (
    sessions as Array<{ id: string; name: string }>
  ).slice(0, 20);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search tasks, repos, terminals and pages">
      <CommandInput placeholder="Search tasks, repos, terminals…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        {taskList.length > 0 && (
          <CommandGroup heading="Tasks">
            {taskList.map((t) => (
              <CommandItem
                key={t.id}
                value={`task ${t.title}`}
                onSelect={() => go(`/tasks/${t.id}`)}
              >
                <ListPlus className="text-amber-500" />
                <span className="truncate">{t.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {repoList.length > 0 && (
          <CommandGroup heading="Repos">
            {repoList.map((r) => (
              <CommandItem
                key={r.id}
                value={`repo ${r.name}`}
                onSelect={() => go("/repos")}
              >
                <FolderGit2 className="text-violet-500" />
                <span className="truncate">{r.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {sessionList.length > 0 && (
          <CommandGroup heading="Terminals">
            {sessionList.map((s) => (
              <CommandItem
                key={s.id}
                value={`terminal ${s.name}`}
                onSelect={() => go(`/sessions/${s.id}`)}
              >
                <Terminal className="text-emerald-500" />
                <span className="truncate">{s.name}</span>
              </CommandItem>
            ))}
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
