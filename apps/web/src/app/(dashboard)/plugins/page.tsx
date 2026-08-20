"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Check,
  Loader2,
  Plus,
  X,
  ExternalLink,
  Trash2,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  usePlugins,
  useConnectPlugin,
  useTestPlugin,
  useDeletePlugin,
} from "@/lib/api/hooks";
import { pluginCatalog, type PluginDef } from "@/lib/plugin-catalog";
import { PluginCard } from "@/components/plugins/plugin-card";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Plugin } from "@/lib/api/types";

type TestStatus = "idle" | "testing" | "ok" | "error";

export default function PluginsPage() {
  const { data: plugins = [], isLoading } = usePlugins();
  const deletePlugin = useDeletePlugin();
  const [dialog, setDialog] = useState<PluginDef | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Plugin | null>(null);

  const byType = useMemo(() => {
    const map = new Map<string, Plugin>();
    for (const p of plugins) map.set(p.type, p);
    return map;
  }, [plugins]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-8 space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Plugins</h1>
        <p className="text-sm text-muted-foreground">
          Plug citshe into your stack — see deploys, database and ads for this
          portal in one place.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {pluginCatalog.map((def) => {
            const connected = byType.get(def.type);
            if (connected) {
              return (
                <div key={def.type} className="space-y-2">
                  <PluginCard type={def.type} />
                  <div className="flex justify-end">
                    <button
                      onClick={() => setRemoveTarget(connected)}
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                      Disconnect {def.name}
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <button
                key={def.type}
                onClick={() => setDialog(def)}
                className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border bg-muted/10 px-4 py-3.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"
              >
                <span className={def.accent}>{def.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{def.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {def.tagline}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Plus className="h-3.5 w-3.5" />
                  Connect
                </span>
              </button>
            );
          })}
        </div>
      )}

      {dialog && (
        <ConnectDialog def={dialog} onClose={() => setDialog(null)} />
      )}

      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect plugin?</AlertDialogTitle>
            <AlertDialogDescription>
              citshe will stop reading status from this provider for this portal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!removeTarget) return;
                try {
                  await deletePlugin.mutateAsync(removeTarget.id);
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Failed to disconnect",
                  );
                } finally {
                  setRemoveTarget(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ConnectDialog({
  def,
  onClose,
}: {
  def: PluginDef;
  onClose: () => void;
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

          {def.fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={field.key}>
                {field.label}
                {field.required && <span className="text-destructive"> *</span>}
              </Label>
              <div className="relative">
                {field.type === "textarea" ? (
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
          ))}

          {testState.status !== "idle" && testState.status !== "testing" && (
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-xs",
                testState.status === "ok"
                  ? "bg-emerald-500/10 text-emerald-600"
                  : "bg-red-500/10 text-red-600",
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
          <Button
            variant="outline"
            onClick={runTest}
            disabled={test.isPending}
          >
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
