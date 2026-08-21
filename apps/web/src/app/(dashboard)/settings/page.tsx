"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import pkg from "../../../../package.json";

const webVersion = pkg.version;
import {
  Plug,
  Bot,
  Building2,
  Users,
  Key,
  Settings,
  Zap,
  ChevronRight,
} from "lucide-react";

const setupLinks = [
  {
    title: "AI",
    description: "Claude Code engine + a panel key (OpenRouter / Claude API)",
    href: "/settings/ai",
    icon: Bot,
  },
  {
    title: "GitHub",
    description: "Connect GitHub to pull in your repositories",
    href: "/settings/integrations",
    icon: Plug,
  },
  {
    title: "Skills",
    description: "Reusable Claude Code instructions for workers",
    href: "/skills",
    icon: Zap,
  },
];

const adminLinks = [
  {
    title: "Organization",
    description: "Name, slug, and organization settings",
    href: "/settings/organization",
    icon: Building2,
  },
  {
    title: "Team",
    description: "Members, roles, and invitations",
    href: "/settings/team",
    icon: Users,
  },
  {
    title: "API Keys",
    description: "External API access for automation",
    href: "/settings/api-keys",
    icon: Key,
  },
  {
    title: "Preferences",
    description: "Theme, language, and display options",
    href: "/settings/preferences",
    icon: Settings,
  },
];

function SettingsGroup({ label, items }: { label: string; items: typeof setupLinks }) {
  return (
    <div>
      <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-text-subtle">
        {label}
      </p>
      <div className="overflow-hidden rounded-md border border-border bg-surface-card">
        {items.map((item, i) => (
          <Link
            key={item.href}
            href={item.href}
            className={`group flex items-center gap-3.5 px-3.5 py-3 transition-linear hover:bg-surface-hover ${
              i > 0 ? "border-t border-border" : ""
            }`}
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-inset text-muted-foreground transition-linear group-hover:text-foreground">
              <item.icon className="size-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{item.title}</p>
              <p className="truncate text-xs text-muted-foreground">{item.description}</p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-text-subtle opacity-0 transition-linear group-hover:translate-x-0.5 group-hover:opacity-100" />
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Manage your integrations, providers, team, and preferences.
        </p>
      </div>

      <div className="space-y-6">
        <SettingsGroup label="Setup" items={setupLinks} />
        <SettingsGroup label="Administration" items={adminLinks} />
      </div>

      <VersionInfo />
    </div>
  );
}

function VersionInfo() {
  const [apiVersion, setApiVersion] = useState<string | null>(null);
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    fetch(`${apiUrl}/health`)
      .then((r) => r.json())
      .then((d) => setApiVersion(d.version))
      .catch(() => {});

    if (typeof window !== "undefined" && window.citsheDesktop?.getVersion) {
      window.citsheDesktop.getVersion().then((v: string) => setDesktopVersion(v)).catch(() => {});
    }
  }, []);

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-4 text-xs text-text-subtle">
      <span>Web v{webVersion}</span>
      {apiVersion && <span>API v{apiVersion}</span>}
      {desktopVersion && <span>Desktop v{desktopVersion}</span>}
    </div>
  );
}
