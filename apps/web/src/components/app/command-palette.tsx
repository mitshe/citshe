"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  FolderOpen,
  ListTodo,
  Plus,
  Settings,
  Loader2,
  Terminal,
  MessageSquare,
} from "lucide-react";
import { useTasks, useRepositories } from "@/lib/api/hooks";
import type { Task, Repository } from "@/lib/api/types";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const navigationItems = [
  { label: "Home", path: "/home", icon: MessageSquare },
  { label: "Threads", path: "/sessions", icon: Terminal },
  { label: "Tasks", path: "/tasks", icon: ListTodo },
  { label: "Repos", path: "/repos", icon: FolderOpen },
  { label: "Settings", path: "/settings", icon: Settings },
  { label: "Integrations", path: "/settings/integrations", icon: Settings },
  { label: "AI Providers", path: "/settings/ai", icon: Settings },
];


export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const { data: tasks = [], isLoading: tasksLoading } = useTasks();
  const { data: repos = [], isLoading: reposLoading } = useRepositories();

  const isLoading = tasksLoading || reposLoading;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  const handleSelect = useCallback(
    (path: string) => {
      onOpenChange(false);
      setQuery("");
      router.push(path);
    },
    [router, onOpenChange],
  );

  const filteredTasks = useMemo(() => {
    if (!query) return tasks.slice(0, 5);
    const lowerQuery = query.toLowerCase();
    return tasks
      .filter(
        (task: Task) =>
          task.title.toLowerCase().includes(lowerQuery) ||
          task.description?.toLowerCase().includes(lowerQuery),
      )
      .slice(0, 8);
  }, [tasks, query]);

  const filteredRepos = useMemo(() => {
    if (!query) return repos.slice(0, 3);
    const lowerQuery = query.toLowerCase();
    return repos
      .filter(
        (repo: Repository) =>
          repo.name.toLowerCase().includes(lowerQuery) ||
          repo.fullPath.toLowerCase().includes(lowerQuery),
      )
      .slice(0, 5);
  }, [repos, query]);

  const quickActions = [
    {
      label: "New Thread",
      icon: Terminal,
      shortcut: "S",
      action: () => handleSelect("/sessions?newSession=1"),
    },
    {
      label: "New Task",
      icon: Plus,
      shortcut: "T",
      action: () => handleSelect("/tasks"),
    },
  ];

  const filteredNavigation = useMemo(() => {
    if (!query) return navigationItems;
    const lowerQuery = query.toLowerCase();
    return navigationItems.filter((item) =>
      item.label.toLowerCase().includes(lowerQuery),
    );
  }, [query]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search tasks, projects and more..."
    >
      <CommandInput
        placeholder="Search tasks, projects..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <CommandEmpty>No results found.</CommandEmpty>

            {!query && (
              <>
                <CommandGroup heading="Quick Actions">
                  {quickActions.map((action) => (
                    <CommandItem
                      key={action.label}
                      onSelect={action.action}
                      className="cursor-pointer"
                    >
                      <action.icon className="mr-2 w-4 h-4" />
                      {action.label}
                      <CommandShortcut>⌘{action.shortcut}</CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}

            {filteredNavigation.length > 0 && (
              <>
                <CommandGroup heading="Navigation">
                  {filteredNavigation.map((item) => (
                    <CommandItem
                      key={item.path}
                      value={`nav-${item.label}`}
                      onSelect={() => handleSelect(item.path)}
                      className="cursor-pointer"
                    >
                      <item.icon className="mr-2 w-4 h-4" />
                      {item.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
                {!query && <CommandSeparator />}
              </>
            )}

            {filteredTasks.length > 0 && (
              <CommandGroup heading="Tasks">
                {filteredTasks.map((task: Task) => (
                  <CommandItem
                    key={task.id}
                    value={`task-${task.id}-${task.title}`}
                    onSelect={() => handleSelect(`/tasks/${task.id}`)}
                    className="cursor-pointer"
                  >
                    <ListTodo className="mr-2 w-4 h-4 text-muted-foreground" />
                    <div className="flex flex-col">
                      <span>{task.title}</span>
                      {task.description && (
                        <span className="text-xs text-muted-foreground line-clamp-1">
                          {task.description}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {filteredRepos.length > 0 && (
              <CommandGroup heading="Repos">
                {filteredRepos.map((repo: Repository) => (
                  <CommandItem
                    key={repo.id}
                    value={`repo-${repo.id}-${repo.name}`}
                    onSelect={() => handleSelect(`/repos`)}
                    className="cursor-pointer"
                  >
                    <FolderOpen className="mr-2 w-4 h-4 text-muted-foreground" />
                    <div className="flex flex-col">
                      <span>{repo.name}</span>
                      <span className="text-xs text-muted-foreground line-clamp-1">
                        {repo.fullPath}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
