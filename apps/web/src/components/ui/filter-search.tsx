"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A GitHub/Linear-style filter search: one text field that accepts `key:value`
 * tokens alongside free text, with a contextual autocomplete dropdown (keys
 * first, then values once you've typed `key:`). Parsed tokens render as chips;
 * the remaining free text filters by name/title.
 *
 * Pages describe their filterable dimensions via `fields` and consume the
 * parsed result via `parseFilterQuery(query, fields)`. This keeps every list's
 * filtering identical in look and behavior.
 */

export interface FilterFieldValue {
  /** The token value written after `key:` (e.g. "in-progress"). No spaces. */
  value: string;
  /** Human label shown in the dropdown (defaults to `value`). */
  label?: string;
  /** Optional right-aligned hint (e.g. a count). */
  hint?: string;
}

export interface FilterField {
  /** The token key, e.g. "status", "repo", "label". Lowercase, no spaces. */
  key: string;
  /** One-line description shown when suggesting the key itself. */
  description?: string;
  /**
   * Allowed values. Provide a static list, or a function for dynamic ones
   * (e.g. repo names). When omitted, the key accepts free-form values.
   */
  values?: FilterFieldValue[] | (() => FilterFieldValue[]);
  /** Allow the same key more than once (e.g. multiple `label:`). Default false. */
  multiple?: boolean;
}

export interface ParsedToken {
  key: string;
  value: string;
}

export interface ParsedFilterQuery {
  /** `key:value` tokens, in order. */
  tokens: ParsedToken[];
  /** Everything that wasn't a recognized token — free-text search. */
  text: string;
}

const TOKEN_RE = /(\w+):("[^"]*"|\S+)/g;

/** Resolve a field's values (static or dynamic). */
function fieldValues(field: FilterField): FilterFieldValue[] {
  if (!field.values) return [];
  return typeof field.values === "function" ? field.values() : field.values;
}

/**
 * Split a raw query into recognized `key:value` tokens and leftover free text.
 * Only keys present in `fields` become tokens; unknown `x:y` stays as text.
 */
export function parseFilterQuery(
  query: string,
  fields: FilterField[],
): ParsedFilterQuery {
  const known = new Set(fields.map((f) => f.key));
  const tokens: ParsedToken[] = [];
  let text = query;

  const matches = [...query.matchAll(TOKEN_RE)];
  for (const m of matches) {
    const key = m[1].toLowerCase();
    if (!known.has(key)) continue;
    const value = m[2].replace(/^"|"$/g, "");
    tokens.push({ key, value });
    text = text.replace(m[0], " ");
  }

  return { tokens, text: text.replace(/\s+/g, " ").trim() };
}

/** Build a token string (used to append a suggestion into the query). */
function tokenStr(key: string, value: string): string {
  const v = /\s/.test(value) ? `"${value}"` : value;
  return `${key}:${v}`;
}

type Suggestion =
  | { kind: "key"; field: FilterField }
  | { kind: "value"; field: FilterField; value: FilterFieldValue };

/** Contextual suggestions for the word under the caret. */
function buildSuggestions(
  lastWord: string,
  fields: FilterField[],
): Suggestion[] {
  const colon = lastWord.indexOf(":");
  if (colon >= 0) {
    // Typing a value: `key:partial` → suggest that key's values.
    const key = lastWord.slice(0, colon).toLowerCase();
    const partial = lastWord.slice(colon + 1).toLowerCase();
    const field = fields.find((f) => f.key === key);
    if (!field) return [];
    return fieldValues(field)
      .filter((v) =>
        `${v.value} ${v.label ?? ""}`.toLowerCase().includes(partial),
      )
      .map((v) => ({ kind: "value" as const, field, value: v }));
  }
  // Typing a key: suggest matching keys.
  const partial = lastWord.toLowerCase();
  return fields
    .filter((f) => f.key.includes(partial))
    .map((f) => ({ kind: "key" as const, field: f }));
}

export function FilterSearch({
  value,
  onChange,
  fields,
  placeholder = "Search… (try status:…)",
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  fields: FilterField[];
  placeholder?: string;
  className?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);

  // The word currently under the caret drives the suggestions. We keep it
  // simple: split on spaces (quoted values are rare enough at type-time).
  const parts = value.split(/\s/);
  const lastWord = parts[parts.length - 1] ?? "";

  // Build the contextual suggestion list. Cheap enough to compute each render;
  // the React compiler memoizes it (a manual useMemo can't preserve the
  // `field.values()` call).
  const suggestions = buildSuggestions(lastWord, fields);

  React.useEffect(() => setActive(0), [lastWord]);

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  /** Replace the word under the caret with `insert`, keeping earlier words. */
  const replaceLastWord = (insert: string, trailingSpace: boolean) => {
    const parts = value.split(/\s/);
    parts[parts.length - 1] = insert;
    const next = parts.join(" ") + (trailingSpace ? " " : "");
    onChange(next);
    // Keep focus; reopen for the next token/value.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const applySuggestion = (s: Suggestion) => {
    if (s.kind === "key") {
      // Insert `key:` and keep the menu open so values suggest next.
      replaceLastWord(`${s.field.key}:`, false);
      setOpen(true);
    } else {
      replaceLastWord(tokenStr(s.field.key, s.value.value), true);
      setOpen(true);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applySuggestion(suggestions[active]);
        return;
      }
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className={cn("relative min-w-0", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="h-9 w-full rounded-md border border-border bg-surface-inset pl-9 pr-8 text-sm text-foreground placeholder:text-muted-foreground transition-linear focus:outline-none focus:ring-2 focus:ring-ring"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground transition-linear hover:bg-surface-hover hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {open && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-[min(320px,50vh)] w-full min-w-[240px] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-2xl">
          {suggestions.map((s, i) => {
            const isKey = s.kind === "key";
            const label = isKey
              ? `${s.field.key}:`
              : s.value.label ?? s.value.value;
            const hint = isKey ? s.field.description : s.value.hint;
            return (
              <button
                key={isKey ? `k-${s.field.key}` : `v-${s.field.key}-${s.value.value}`}
                type="button"
                // Prevent the input blur before the click registers.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applySuggestion(s)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm transition-linear",
                  i === active
                    ? "bg-surface-hover text-foreground"
                    : "text-muted-foreground hover:bg-surface-hover/60 hover:text-foreground",
                )}
              >
                <span className="flex items-center gap-2">
                  {!isKey && (
                    <span className="font-mono text-[11px] text-text-subtle">
                      {s.field.key}:
                    </span>
                  )}
                  <span className={cn(isKey && "font-mono")}>{label}</span>
                </span>
                {hint && (
                  <span className="shrink-0 text-[11px] text-text-subtle">
                    {hint}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
