"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  ListTodo,
  FolderGit2,
  SquareTerminal,
  Zap,
  Clock,
  Cog,
  Plus,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { OrgSwitcher } from "./org-switcher";
import { OPEN_COMMAND_EVENT } from "./command-palette";
import { usePlugins } from "@/lib/api/hooks";
import { getPluginDef } from "@/lib/plugin-catalog";

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  tourId?: string;
}

const primaryNav: NavItem[] = [
  { title: "Home", href: "/home", icon: Home, tourId: "nav-home" },
  { title: "Tasks", href: "/tasks", icon: ListTodo, tourId: "nav-tasks" },
  { title: "Repos", href: "/repos", icon: FolderGit2, tourId: "nav-repos" },
  {
    title: "Terminals",
    href: "/sessions",
    icon: SquareTerminal,
    tourId: "nav-sessions",
  },
  { title: "Skills", href: "/skills", icon: Zap, tourId: "nav-skills" },
  { title: "Schedules", href: "/schedules", icon: Clock, tourId: "nav-schedules" },
];

function openCommand() {
  window.dispatchEvent(new Event(OPEN_COMMAND_EVENT));
}

/** Section label — Vercel-style 13px uppercase, with a subtle top separator. */
const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <p className="px-2.5 pb-1.5 text-[13px] font-medium uppercase tracking-wide text-text-subtle">
    {children}
  </p>
);

/**
 * A single nav row — Vercel-style.
 * Active = full rounded-md surface-hover pill (icon + label → foreground).
 * Inactive = muted, hover lifts to a faint fill + foreground text.
 * Collapsed → icon + tooltip.
 */
function NavRow({
  href,
  label,
  icon,
  active,
  collapsed,
  onNavigate,
  tourId,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
  tourId?: string;
}) {
  const row = (
    <Link
      href={href}
      onClick={onNavigate}
      data-tour={tourId}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-[38px] items-center rounded-md text-[15px] transition-linear focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        collapsed ? "w-full justify-center" : "gap-3 px-2.5",
        active
          ? "bg-surface-hover font-semibold text-foreground"
          : "font-medium text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "flex h-[18px] w-[18px] shrink-0 items-center justify-center [&>svg]:h-[18px] [&>svg]:w-[18px]",
          !active && "text-muted-foreground group-hover:text-foreground",
        )}
      >
        {icon}
      </span>
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );

  if (!collapsed) return row;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Sidebar search — faux input opening the command palette (Vercel "Find"). */
function SidebarSearch({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={openCommand}
            className="flex h-[38px] w-full items-center justify-center rounded-md text-muted-foreground transition-linear hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            aria-label="Search"
          >
            <Search className="h-[18px] w-[18px]" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Search</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button
      onClick={openCommand}
      className="flex h-[38px] w-full items-center gap-2.5 rounded-md border border-border bg-surface-inset px-2.5 text-[15px] text-muted-foreground transition-linear hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <Search className="h-[18px] w-[18px] shrink-0" />
      <span>Search…</span>
      <Kbd className="ml-auto">⌘K</Kbd>
    </button>
  );
}

/** Connected stack tools — one row per plugin + "Add tool". */
function StackNav({
  isActive,
  collapsed,
  onNavigate,
}: {
  isActive: (href: string) => boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { data: plugins = [] } = usePlugins();

  return (
    <div className="mt-5 space-y-0.5 border-t border-border pt-5">
      {!collapsed && <SectionHeading>Stack</SectionHeading>}
      {plugins.map((p) => {
        const def = getPluginDef(p.type);
        if (!def) return null;
        const href = `/stack/${p.type.toLowerCase()}`;
        return (
          <NavRow
            key={p.type}
            href={href}
            label={def.name}
            active={isActive(href)}
            collapsed={collapsed}
            onNavigate={onNavigate}
            icon={def.icon}
          />
        );
      })}
      <NavRow
        href="/stack"
        label="Add tool"
        active={
          isActive("/stack") &&
          !plugins.some((p) => isActive(`/stack/${p.type.toLowerCase()}`))
        }
        collapsed={collapsed}
        onNavigate={onNavigate}
        icon={<Plus className="h-[18px] w-[18px]" />}
      />
    </div>
  );
}

/**
 * The scrollable body of the sidebar (org switcher + search + nav sections).
 * Shared between the desktop sidebar and the mobile Sheet drawer.
 */
export function SidebarBody({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("mb-3", collapsed && "flex justify-center")}>
        <OrgSwitcher collapsed={collapsed} />
      </div>

      <div className="mb-4">
        <SidebarSearch collapsed={collapsed} />
      </div>

      <div className="space-y-0.5">
        {primaryNav.map((item) => (
          <NavRow
            key={item.href}
            href={item.href}
            label={item.title}
            active={isActive(item.href)}
            collapsed={collapsed}
            onNavigate={onNavigate}
            tourId={item.tourId}
            icon={<item.icon className="h-[18px] w-[18px]" />}
          />
        ))}
      </div>

      <StackNav isActive={isActive} collapsed={collapsed} onNavigate={onNavigate} />
    </TooltipProvider>
  );
}

/** Settings row pinned at the bottom. */
function SettingsRow({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active =
    pathname === "/settings" || pathname.startsWith("/settings/");
  return (
    <TooltipProvider delayDuration={200}>
      <NavRow
        href="/settings"
        label="Settings"
        active={active}
        collapsed={collapsed}
        onNavigate={onNavigate}
        icon={<Cog className="h-[18px] w-[18px]" />}
      />
    </TooltipProvider>
  );
}

/** Brand — TEXT ONLY. Collapsed → monogram "c". No logo image. */
function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link
      href="/home"
      className="flex items-center rounded-sm font-brand text-lg font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {collapsed ? "c" : "citshe"}
    </Link>
  );
}

/**
 * Desktop sidebar. ~248px expanded, 56px collapsed.
 * Collapse state is owned by the shell (persisted to localStorage there).
 */
export function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-border bg-sidebar transition-[width] duration-150",
        collapsed ? "w-14" : "w-[248px]",
      )}
    >
      <div
        className={cn(
          "flex h-12 shrink-0 items-center border-b border-border",
          collapsed ? "justify-center px-0" : "justify-between px-3",
        )}
      >
        {!collapsed && <Brand collapsed={false} />}
        <button
          onClick={onToggle}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-linear hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <SidebarBody collapsed={collapsed} />
      </div>

      <div className="shrink-0 border-t border-border px-2 py-2">
        <SettingsRow collapsed={collapsed} />
      </div>
    </aside>
  );
}
