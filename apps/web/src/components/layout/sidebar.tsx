"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  FolderKanban,
  ListTodo,
  MessageSquareCode,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  MessageCircle,
  Zap,
  Home,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OrgSwitcher } from "./org-switcher";
import { useSessions } from "@/lib/api/hooks";

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  tourId?: string;
}

/** Primary, always-visible actions — the simple flow. */
const primaryNav: NavItem[] = [
  { title: "Home", href: "/home", icon: Home, tourId: "nav-home" },
  { title: "Chat", href: "/chat", icon: MessageCircle, tourId: "nav-chat" },
  { title: "Tasks", href: "/tasks", icon: ListTodo, tourId: "nav-tasks" },
];

/** Power-user sections, tucked under a collapsible "Advanced" group. */
const advancedNav: NavItem[] = [
  { title: "Threads", href: "/sessions", icon: MessageSquareCode, tourId: "nav-sessions" },
  { title: "Projects", href: "/projects", icon: FolderKanban, tourId: "nav-projects" },
  { title: "Skills", href: "/skills", icon: Zap, tourId: "nav-skills" },
];

const ADVANCED_PATHS = advancedNav.map((i) => i.href);

interface SidebarContentProps {
  onNavigate?: () => void;
}

export function SidebarContent({ onNavigate }: SidebarContentProps) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const onAdvancedPath = ADVANCED_PATHS.some((p) => isActive(p));
  const [advancedOpen, setAdvancedOpen] = useState(onAdvancedPath);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="mb-4">
        <OrgSwitcher />
      </div>

      <div className="space-y-0.5">
        {primaryNav.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(item.href)}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      <div className="mt-4">
        <button
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex w-full items-center justify-between px-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          <span>Advanced</span>
          <ChevronDown
            className={cn(
              "h-3 w-3 transition-transform",
              advancedOpen && "rotate-180",
            )}
          />
        </button>
        {advancedOpen && (
          <div className="space-y-0.5">
            {advancedNav.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isActive(item.href)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}
      </div>

      <RecentSessions onNavigate={onNavigate} />
    </TooltipProvider>
  );
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      data-tour={item.tourId}
      className={cn(
        "flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors",
        active
          ? "bg-secondary text-foreground font-medium"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
      )}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      {item.title}
    </Link>
  );
}

function RecentSessions({ onNavigate }: { onNavigate?: () => void }) {
  const { data: sessions = [] } = useSessions();
  const typed = sessions as Array<{ id: string; name: string; status: string }>;
  const active = typed.filter(
    (s) => s.status === "RUNNING" || s.status === "CREATING",
  );

  if (active.length === 0) return null;

  return (
    <div className="mt-4 space-y-0.5">
      <p className="px-3 pb-1 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
        Running
      </p>
      {active.map((s) => (
        <Link
          key={s.id}
          href={`/sessions/${s.id}`}
          onClick={onNavigate}
          className="flex items-center gap-2.5 px-3 py-1 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-emerald-500" />
          <span className="truncate">{s.name}</span>
        </Link>
      ))}
    </div>
  );
}

export function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const isSettingsActive =
    pathname === "/settings" || pathname.startsWith("/settings/");

  if (collapsed) {
    return (
      <div className="flex h-full w-12 flex-col bg-sidebar rounded-xl items-center">
        <div className="flex h-14 items-center justify-center w-full shrink-0">
          <button
            onClick={onToggle}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Expand sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center gap-1.5 py-3">
          {primaryNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title={item.title}
            >
              <item.icon className="h-4 w-4" />
            </Link>
          ))}
        </div>
        <div className="py-2 w-full flex flex-col items-center gap-1.5 shrink-0">
          <Link
            href="/settings"
            className={cn(
              "p-2 rounded-md transition-colors",
              isSettingsActive
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-64 flex-col bg-sidebar border-1 border-border rounded-xl">
      <div className="flex h-14 items-center justify-between px-3 shrink-0">
        <Link href="/home" className="flex items-center gap-2 font-semibold">
          <img src="/logo.svg" alt="mitshe" className="h-7 w-7" />
          <span className="font-brand text-sm">mitshe</span>
        </Link>
        <button
          onClick={onToggle}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          title="Collapse sidebar"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-1 py-4">
        <SidebarContent />
      </div>
      <div className="px-3 py-2 shrink-0">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors",
            isSettingsActive
              ? "bg-secondary text-foreground font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
          )}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>
    </div>
  );
}
