"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Search,
  Menu,
  LogOut,
  Settings,
  Sun,
  Moon,
  Monitor,
  Check,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarBody } from "./sidebar";
import { OPEN_COMMAND_EVENT } from "./command-palette";
import { useAuthContext } from "@/lib/auth";
import { cn } from "@/lib/utils";

function userInitials(name: string | null, email: string | null): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function openCommand() {
  window.dispatchEvent(new Event(OPEN_COMMAND_EVENT));
}

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function Topbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { userName, userEmail, signOut } = useAuthContext();
  const { theme, setTheme } = useTheme();

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3 pt-safe">
      <div className="flex items-center gap-2">
        {/* Mobile hamburger → drawer */}
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 md:hidden"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>

      </div>

      <div className="flex items-center gap-1.5">
        {/* Search lives in the sidebar (Vercel-style). Only shown here on
            mobile, where the sidebar is a closed drawer. */}
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 md:hidden"
          onClick={openCommand}
          aria-label="Search"
        >
          <Search className="h-4 w-4" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-8 items-center gap-2 rounded-md border border-border px-1.5 pr-2 text-sm transition-linear hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/15 text-[10px] font-semibold text-primary">
                {userInitials(userName, userEmail)}
              </span>
              <span className="hidden max-w-[120px] truncate text-muted-foreground sm:inline">
                {userName || userEmail}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
              {userName || userEmail}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings" className="gap-2">
                <Settings className="h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Theme
            </DropdownMenuLabel>
            {THEMES.map((t) => (
              <DropdownMenuItem
                key={t.value}
                onClick={() => setTheme(t.value)}
                className="gap-2"
              >
                <t.icon className="h-4 w-4" />
                {t.label}
                <Check
                  className={cn(
                    "ml-auto h-4 w-4",
                    theme === t.value ? "opacity-100" : "opacity-0",
                  )}
                />
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut()} className="gap-2">
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mobile drawer renders the sidebar body */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="flex w-[17rem] max-w-[85vw] flex-col p-0">
          <SheetHeader className="flex h-12 flex-row items-center border-b border-border px-3">
            <SheetTitle className="font-brand text-lg font-semibold tracking-tight">
              citshe
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            <SidebarBody onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
