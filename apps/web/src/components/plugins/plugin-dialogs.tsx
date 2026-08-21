"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, Loader2, Plus, X, ExternalLink, Eye, EyeOff } from "lucide-react";
import {
  useConnectPlugin,
  useTestPlugin,
  usePluginResources,
  useSetPluginSelection,
} from "@/lib/api/hooks";
import { type PluginDef } from "@/lib/plugin-catalog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { PluginSelection } from "@/lib/api/types";

type TestStatus = "idle" | "testing" | "ok" | "error";

/** Connect a stack tool — token fields + Test + Connect. */
export function ConnectDialog({
  def,
  onClose,
  onConnected,
}: {
  def: PluginDef;
  onClose: () => void;
  onConnected?: () => void;
}) {
  const connect = useConnectPlugin();
  const test = useTestPlugin();
  const [form, setForm] = useState<Record<string, string>>({});
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [testState, setTestState] = useState<{
    status: TestStatus;
    message?: string;
  }>({ status: "idle" });

  const missing = def.fields
    .filter((f) => f.required && !form[f.key]?.trim())
    .map((f) => f.label);

  const runTest = async () => {
    if (missing.length) {
      toast.error(`Fill required fields: ${missing.join(", ")}`);
      return;
    }
    setTestState({ status: "testing" });
    try {
      const res = await test.mutateAsync({ type: def.type, config: form });
      setTestState({
        status: res.success ? "ok" : "error",
        message: res.message,
      });
    } catch (err) {
      setTestState({
        status: "error",
        message: err instanceof Error ? err.message : "Test failed",
      });
    }
  };

  const runConnect = async () => {
    if (missing.length) {
      toast.error(`Fill required fields: ${missing.join(", ")}`);
      return;
    }
    try {
      await connect.mutateAsync({ type: def.type, config: form });
      toast.success(`${def.name} connected`);
      onConnected?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className={def.accent}>{def.icon}</span>
            <div>
              <DialogTitle>Connect {def.name}</DialogTitle>
              <DialogDescription>{def.tagline}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {def.docsUrl && (
            <a
              href={def.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              How to get credentials
            </a>
          )}

          {def.fields.map((field) => {
            // Hide key/passphrase vs password based on the chosen auth method.
            const authMethod = form["authMethod"] || "key";
            if (
              (field.key === "privateKey" || field.key === "passphrase") &&
              authMethod === "password"
            ) {
              return null;
            }
            if (field.key === "password" && authMethod !== "password") {
              return null;
            }
            return (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={field.key}>
                {field.label}
                {field.required && <span className="text-destructive"> *</span>}
              </Label>
              <div className="relative">
                {field.type === "select" ? (
                  <Select
                    value={form[field.key] || field.options?.[0]?.value || ""}
                    onValueChange={(v) =>
                      setForm({ ...form, [field.key]: v })
                    }
                  >
                    <SelectTrigger id={field.key}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options?.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.type === "textarea" ? (
                  <Textarea
                    id={field.key}
                    rows={5}
                    placeholder={field.placeholder}
                    value={form[field.key] || ""}
                    onChange={(e) =>
                      setForm({ ...form, [field.key]: e.target.value })
                    }
                    className="font-mono text-xs"
                  />
                ) : (
                  <Input
                    id={field.key}
                    type={
                      field.type === "password" && !show[field.key]
                        ? "password"
                        : "text"
                    }
                    placeholder={field.placeholder}
                    value={form[field.key] || ""}
                    onChange={(e) =>
                      setForm({ ...form, [field.key]: e.target.value })
                    }
                  />
                )}
                {field.type === "password" && (
                  <button
                    type="button"
                    onClick={() =>
                      setShow({ ...show, [field.key]: !show[field.key] })
                    }
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {show[field.key] ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>
              {field.helpText && (
                <p className="text-[11px] text-muted-foreground">
                  {field.helpText}
                </p>
              )}
            </div>
            );
          })}

          {testState.status !== "idle" && testState.status !== "testing" && (
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-xs",
                testState.status === "ok"
                  ? "bg-ok/10 text-ok"
                  : "bg-danger/10 text-danger",
              )}
            >
              {testState.status === "ok" ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
              {testState.message}
            </div>
          )}
        </DialogBody>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={runTest} disabled={test.isPending}>
            {test.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-1.5 h-4 w-4" />
            )}
            Test
          </Button>
          <Button onClick={runConnect} disabled={connect.isPending}>
            {connect.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1.5 h-4 w-4" />
            )}
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Choose which resources matter for this portal (checkboxes). */
export function ResourcePicker({
  type,
  onClose,
}: {
  type: string;
  onClose: () => void;
}) {
  const { data, isLoading } = usePluginResources(type);
  const save = useSetPluginSelection(type);
  const [sel, setSel] = useState<Record<string, Set<string>>>({});
  const [seeded, setSeeded] = useState(false);

  if (data && !seeded) {
    const initial: Record<string, Set<string>> = {};
    for (const g of data.groups) {
      const chosen = (data.selected as PluginSelection)?.[g.kind] ?? [];
      initial[g.kind] = new Set(chosen);
    }
    setSel(initial);
    setSeeded(true);
  }

  const toggle = (kind: string, id: string) => {
    setSel((prev) => {
      const next = { ...prev, [kind]: new Set(prev[kind] ?? []) };
      if (next[kind].has(id)) next[kind].delete(id);
      else next[kind].add(id);
      return next;
    });
  };

  const onSave = async () => {
    const selection: Record<string, string[]> = {};
    for (const [kind, set] of Object.entries(sel)) {
      if (set.size) selection[kind] = [...set];
    }
    try {
      await save.mutateAsync(selection);
      toast.success("Resources updated");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Configure resources</DialogTitle>
          <DialogDescription>
            Pick what matters for this portal. Leave everything unchecked to show
            all.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-[60vh] space-y-4 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (data?.groups.length ?? 0) === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No resources found for this token.
            </p>
          ) : (
            data!.groups.map((g) => (
              <div key={g.kind} className="space-y-1.5">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  {g.label}
                </p>
                <div className="space-y-1">
                  {g.items.map((it) => {
                    const checked = sel[g.kind]?.has(it.id) ?? false;
                    return (
                      <button
                        key={it.id}
                        onClick={() => toggle(g.kind, it.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-linear",
                          checked
                            ? "border-primary/40 bg-primary/5"
                            : "border-border hover:bg-muted/40",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            checked
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border",
                          )}
                        >
                          {checked && <Check className="h-3 w-3" />}
                        </span>
                        <span className="truncate">{it.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
