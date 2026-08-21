"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Plus, Building2 } from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { StatusDot } from "@/components/ui/status-dot";
import { CreateOrgDialog } from "@/components/layout/create-org-dialog";

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

/** Colored initials square shared by the trigger + collapsed rail. */
function OrgSquare({
  id,
  name,
  size = 22,
}: {
  id: string | null;
  name: string | null;
  size?: number;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white",
        id ? orgColor(id) : "bg-surface-hover text-muted-foreground",
      )}
      style={{ width: size, height: size }}
    >
      {name ? initials(name) : <Building2 className="h-3.5 w-3.5" />}
    </span>
  );
}

export function OrgSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { organizations, currentOrg, switchOrganization, isSwitchingOrg } =
    useAuthContext();
  const [createOpen, setCreateOpen] = useState(false);

  // No portals yet → "Add portal" affordance.
  if (organizations.length === 0) {
    if (collapsed) {
      return (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setCreateOpen(true)}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground transition-linear hover:bg-surface-hover hover:text-foreground"
              >
                <Plus className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Add portal</TooltipContent>
          </Tooltip>
          <CreateOrgDialog open={createOpen} onOpenChange={setCreateOpen} />
        </>
      );
    }
    return (
      <>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex w-full items-center gap-2 rounded-md border border-dashed border-border px-2 py-1.5 text-sm text-muted-foreground transition-linear hover:bg-surface-hover hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
          <span>Add portal</span>
        </button>
        <CreateOrgDialog open={createOpen} onOpenChange={setCreateOpen} />
      </>
    );
  }

  const trigger = collapsed ? (
    <button className="flex h-8 w-8 items-center justify-center rounded-md transition-linear hover:bg-surface-hover">
      <OrgSquare id={currentOrg?.id ?? null} name={currentOrg?.name ?? null} />
    </button>
  ) : (
    <button className="flex w-full items-center gap-2 rounded-md border border-border bg-surface-inset px-2 py-1.5 text-sm transition-linear hover:bg-surface-hover">
      <OrgSquare id={currentOrg?.id ?? null} name={currentOrg?.name ?? null} />
      <span className="flex-1 truncate text-left font-medium">
        {currentOrg?.name ?? "Select portal"}
      </span>
      {isSwitchingOrg ? (
        <StatusDot state="creating" className="shrink-0" />
      ) : (
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
      )}
    </button>
  );

  return (
    <>
      <DropdownMenu>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">
              {currentOrg?.name ?? "Select portal"}
            </TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        )}
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-text-subtle">
            Portals
          </DropdownMenuLabel>
          {organizations.map((org) => (
            <DropdownMenuItem
              key={org.id}
              onClick={() => switchOrganization(org.id)}
              className="gap-2 py-1.5"
            >
              <OrgSquare id={org.id} name={org.name} size={20} />
              <span className="flex-1 truncate">{org.name}</span>
              {org.id === currentOrg?.id && (
                <Check className="h-4 w-4 shrink-0 text-primary" />
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setCreateOpen(true)}
            className="gap-2 py-1.5"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-dashed border-border">
              <Plus className="h-3 w-3" />
            </span>
            <span>New portal</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateOrgDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
