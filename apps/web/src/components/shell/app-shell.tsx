"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { Breadcrumbs } from "./breadcrumbs";
import { OnboardingTour } from "@/components/onboarding-tour";
import { ThreadNotifications } from "@/components/thread-notifications";

const COLLAPSE_KEY = "citshe.sidebar.collapsed";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  // Restore persisted collapse state on mount.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <div className="flex h-screen bg-background text-foreground">
      <div className="hidden shrink-0 md:flex">
        <Sidebar collapsed={collapsed} onToggle={toggle} />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="relative flex-1 overflow-auto">
          <Breadcrumbs />
          {children}
        </main>
      </div>
      <OnboardingTour />
      <ThreadNotifications />
    </div>
  );
}
