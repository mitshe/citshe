"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bot,
  Plug,
  Zap,
  Building2,
  Users,
  Key,
  Settings,
  FolderGit2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SettingsNavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface SettingsNavGroup {
  label: string;
  items: SettingsNavItem[];
}

const navGroups: SettingsNavGroup[] = [
  {
    label: "Setup",
    items: [
      { title: "AI", href: "/settings/ai", icon: Bot },
      { title: "GitHub", href: "/settings/integrations", icon: Plug },
      { title: "Repositories", href: "/settings/repositories", icon: FolderGit2 },
      { title: "Skills", href: "/skills", icon: Zap },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Organization", href: "/settings/organization", icon: Building2 },
      { title: "Team", href: "/settings/team", icon: Users },
      { title: "API Keys", href: "/settings/api-keys", icon: Key },
      { title: "Preferences", href: "/settings/preferences", icon: Settings },
    ],
  },
];

const allItems = navGroups.flatMap((g) => g.items);

/**
 * A settings sub-nav row — mirrors the main sidebar's NavRow visual language.
 * Active = full rounded surface-hover pill (icon + label → foreground).
 * Inactive = muted, hover lifts to a faint fill + foreground text.
 */
function SubNavRow({
  item,
  active,
}: {
  item: SettingsNavItem;
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-[34px] items-center gap-3 rounded-md px-2.5 text-[15px] transition-linear focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        active
          ? "bg-surface-hover font-semibold text-foreground"
          : "font-medium text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "flex h-[18px] w-[18px] shrink-0 items-center justify-center",
          !active && "text-muted-foreground group-hover:text-foreground",
        )}
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="truncate">{item.title}</span>
    </Link>
  );
}

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const activeItem = allItems.find((i) => isActive(i.href));

  return (
    <div className="flex min-h-full w-full flex-col lg:flex-row">
      {/* Mobile: select at top */}
      <div className="border-b border-border p-3 lg:hidden">
        <select
          value={activeItem?.href ?? ""}
          onChange={(e) => router.push(e.target.value)}
          className="h-9 w-full rounded-md border border-border bg-surface-inset px-2.5 text-[15px] text-foreground transition-linear focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label="Settings section"
        >
          {navGroups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.items.map((item) => (
                <option key={item.href} value={item.href}>
                  {item.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Desktop: sticky left sub-nav */}
      <aside className="hidden shrink-0 lg:block lg:w-[220px]">
        <nav className="sticky top-0 max-h-screen space-y-6 overflow-y-auto p-4">
          {navGroups.map((group) => (
            <div key={group.label} className="space-y-0.5">
              <p className="px-2.5 pb-1.5 text-[13px] font-medium uppercase tracking-wide text-text-subtle">
                {group.label}
              </p>
              {group.items.map((item) => (
                <SubNavRow
                  key={item.href}
                  item={item}
                  active={isActive(item.href)}
                />
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* Content — left-aligned, generous width, NOT centered */}
      <div className="min-w-0 flex-1 lg:border-l lg:border-border">
        <div className="w-full max-w-5xl">{children}</div>
      </div>
    </div>
  );
}
