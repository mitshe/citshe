"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
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

  // Lock body scroll while the dashboard shell owns the viewport, so mobile
  // browsers don't add a second body-level scroll behind the address bar.
  // Removed on unmount so docs / auth pages scroll normally.
  useEffect(() => {
    document.body.classList.add("shell-locked");
    return () => document.body.classList.remove("shell-locked");
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
    <div className="flex h-[100dvh] bg-background text-foreground">
      <div className="hidden shrink-0 md:flex">
        <Sidebar collapsed={collapsed} onToggle={toggle} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          {children}
        </main>
      </div>
      <OnboardingTour />
      <ThreadNotifications />
    </div>
  );
}
