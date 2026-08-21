"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

const pathLabels: Record<string, string> = {
  tasks: "Tasks",
  sessions: "Terminals",
  repos: "Repos",
  stack: "Stack",
  skills: "Skills",
  settings: "Settings",
  integrations: "Integrations",
  ai: "AI Providers",
  repositories: "Repositories",
  organization: "Organization",
  team: "Team",
  "api-keys": "API Keys",
  preferences: "Preferences",
  edit: "Edit",
  docs: "Documentation",
};

function isDynamicSegment(segment: string): boolean {
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      segment,
    )
  ) {
    return true;
  }
  if (/^c[a-z0-9]{24,}$/i.test(segment)) {
    return true;
  }
  if (segment.startsWith("cm") && segment.length > 20) {
    return true;
  }
  return false;
}

export function Breadcrumbs() {
  const pathname = usePathname();

  // Hide on the open-terminal view.
  if (/^\/sessions\/[^/]+$/.test(pathname) || pathname.endsWith("/terminal")) {
    return null;
  }

  const segments = pathname.split("/").filter(Boolean);

  const breadcrumbs: BreadcrumbItem[] = [];
  let currentPath = "";

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    currentPath += `/${segment}`;

    if (isDynamicSegment(segment)) {
      if (i === segments.length - 1) {
        const prevSegment = segments[i - 1];
        if (prevSegment === "tasks") {
          breadcrumbs.push({ label: "Task Details" });
        } else {
          breadcrumbs.push({ label: "Details" });
        }
      }
      continue;
    }

    const label =
      pathLabels[segment] || segment.charAt(0).toUpperCase() + segment.slice(1);
    const isLast = i === segments.length - 1;

    breadcrumbs.push({
      label,
      href: isLast ? undefined : currentPath,
    });
  }

  if (breadcrumbs.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 px-6 pt-4 text-[13px] text-text-subtle"
    >
      <Link
        href="/home"
        className="flex items-center transition-linear hover:text-foreground"
      >
        <Home className="h-3.5 w-3.5" />
      </Link>

      {breadcrumbs.map((item, index) => (
        <div key={index} className="flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 text-text-subtle/60" />
          {item.href ? (
            <Link
              href={item.href}
              className="transition-linear hover:text-foreground"
            >
              {item.label}
            </Link>
          ) : (
            <span className="font-medium text-foreground">{item.label}</span>
          )}
        </div>
      ))}
    </nav>
  );
}
