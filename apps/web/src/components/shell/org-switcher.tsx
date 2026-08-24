"use client";

import { useRouter } from "next/navigation";
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
        "flex shrink-0 items-center justify-center rounded-md text-[10px] font-bold",
        id ? "bg-primary/15 text-primary" : "bg-surface-hover text-muted-foreground",
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
  const router = useRouter();

  // "New portal" is a full page (the wizard). Existing-repo connect lives on
  // that page too.
  const newPortal = () => router.push("/new-portal");

  // No portals yet → "Add portal" affordance.
  if (organizations.length === 0) {
    if (collapsed) {
      return (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={newPortal}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground transition-linear hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <Plus className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Add portal</TooltipContent>
          </Tooltip>
        </>
      );
    }
    return (
      <button
        onClick={newPortal}
        className="flex w-full items-center gap-2 rounded-md border border-dashed border-border px-2 py-1.5 text-sm text-muted-foreground transition-linear hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <Plus className="h-4 w-4" />
        <span>Add portal</span>
      </button>
    );
  }

  const trigger = collapsed ? (
    <button className="flex h-8 w-8 items-center justify-center rounded-md transition-linear hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
      <OrgSquare id={currentOrg?.id ?? null} name={currentOrg?.name ?? null} />
    </button>
  ) : (
    <button className="flex w-full items-center gap-2 rounded-md border border-border bg-surface-inset px-2 py-1.5 text-sm transition-linear hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
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
          <DropdownMenuItem onClick={newPortal} className="gap-2 py-1.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-dashed border-border">
              <Plus className="h-3 w-3" />
            </span>
            <span>New portal</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
