"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Loader2, Plus, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthContext } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateOrgDialog } from "./create-org-dialog";

/** Deterministic accent color per portal, from its id. */
function orgColor(id: string): string {
  const colors = [
    "bg-emerald-500",
    "bg-blue-500",
    "bg-purple-500",
    "bg-amber-500",
    "bg-rose-500",
    "bg-cyan-500",
    "bg-indigo-500",
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return colors[hash % colors.length];
}

function initials(name: string): string {
  const clean = name.replace(/\.(com|pl|org|net|io)$/i, "");
  return clean.slice(0, 2).toUpperCase();
}

export function OrgSwitcher({ className }: { className?: string }) {
  const { organizations, currentOrg, switchOrganization, isSwitchingOrg } =
    useAuthContext();
  const [createOpen, setCreateOpen] = useState(false);

  if (organizations.length === 0) {
    return (
      <>
        <button
          onClick={() => setCreateOpen(true)}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-2.5 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors",
            className,
          )}
        >
          <Plus className="h-4 w-4" />
          <span>Add portal</span>
        </button>
        <CreateOrgDialog open={createOpen} onOpenChange={setCreateOpen} />
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg border border-border bg-background/60 px-2.5 py-2 text-sm hover:bg-muted/50 transition-colors",
              className,
            )}
          >
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white",
                currentOrg ? orgColor(currentOrg.id) : "bg-muted",
              )}
            >
              {currentOrg ? initials(currentOrg.name) : <Building2 className="h-4 w-4" />}
            </span>
            <span className="flex-1 truncate text-left font-medium">
              {currentOrg?.name ?? "Select portal"}
            </span>
            {isSwitchingOrg ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
            Portals
          </DropdownMenuLabel>
          {organizations.map((org) => (
            <DropdownMenuItem
              key={org.id}
              onClick={() => switchOrganization(org.id)}
              className="gap-2.5 py-2"
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[9px] font-bold text-white",
                  orgColor(org.id),
                )}
              >
                {initials(org.name)}
              </span>
              <span className="flex-1 truncate">{org.name}</span>
              {org.id === currentOrg?.id && (
                <Check className="h-4 w-4 shrink-0 text-primary" />
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)} className="gap-2.5 py-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-dashed border-border">
              <Plus className="h-3.5 w-3.5" />
            </span>
            <span>New portal</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateOrgDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
