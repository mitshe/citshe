"use client";

import { useMemo, useState } from "react";
import { Plus, Check } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

// Handy labels we offer even before the org has created any. "przeklikać"
// marks a task that a human does by hand (not the AI) — see MANUAL_LABELS.
const SUGGESTED_LABELS = ["przeklikać", "research", "bug", "content"];

/**
 * Add-a-label control: pick from labels that already exist across the org's
 * tasks, or type a new one and create it. `suggestions` is the pool of known
 * labels; `selected` are the ones already on this task (shown checked / hidden
 * from the create hint).
 */
export function LabelEditor({
  selected,
  suggestions,
  onAdd,
  triggerClassName,
}: {
  selected: string[];
  suggestions: string[];
  onAdd: (label: string) => void;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const clean = query.trim().toLowerCase().replace(/^#/, "");
  const available = useMemo(
    () => suggestions.filter((s) => !selected.includes(s)).sort(),
    [suggestions, selected],
  );
  // Suggested labels not already used or selected — offered to bootstrap.
  const suggested = useMemo(
    () =>
      SUGGESTED_LABELS.filter(
        (s) => !selected.includes(s) && !available.includes(s),
      ),
    [selected, available],
  );
  const exactExists =
    available.includes(clean) ||
    selected.includes(clean) ||
    suggested.includes(clean);

  const pick = (label: string) => {
    const value = label.trim().toLowerCase().replace(/^#/, "");
    if (value) onAdd(value);
    setQuery("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-md border border-dashed border-border px-2 text-xs text-muted-foreground transition-linear hover:border-border-strong hover:text-foreground",
            triggerClassName,
          )}
        >
          <Plus className="h-3 w-3" />
          Add label
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Find or create…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {available.length === 0 && !clean && (
              <CommandEmpty>No labels yet — type to create one.</CommandEmpty>
            )}
            {available.length > 0 && (
              <CommandGroup heading="Existing">
                {available.map((label) => (
                  <CommandItem
                    key={label}
                    value={label}
                    onSelect={() => pick(label)}
                  >
                    <Check className="mr-2 h-3.5 w-3.5 opacity-0" />
                    {label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {suggested.length > 0 && (
              <CommandGroup heading="Suggested">
                {suggested.map((label) => (
                  <CommandItem
                    key={label}
                    value={label}
                    onSelect={() => pick(label)}
                  >
                    <Plus className="mr-2 h-3.5 w-3.5 opacity-60" />
                    {label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {clean && !exactExists && (
              <CommandGroup heading="Create">
                <CommandItem value={`create-${clean}`} onSelect={() => pick(clean)}>
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Create &ldquo;{clean}&rdquo;
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
