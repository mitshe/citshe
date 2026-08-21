"use client";

import { useState } from "react";
import { Loader2, Plus, Eye, EyeOff } from "lucide-react";
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
import { useRunPluginAction } from "@/lib/api/hooks";
import { toast } from "sonner";

/**
 * Fields for one VPS server. A superset of the connect-flow fields plus a
 * friendly `label`, since the plugin now holds a LIST of servers and each row
 * needs a name.
 */
interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "password" | "textarea" | "select";
  options?: { value: string; label: string }[];
  required?: boolean;
  helpText?: string;
}

const VPS_FIELDS: FieldDef[] = [
  {
    key: "label",
    label: "Name",
    placeholder: "e.g. web-1 / db / hetzner-fsn",
    required: true,
    helpText: "How this server shows up in the list.",
  },
  {
    key: "authMethod",
    label: "Auth",
    type: "select",
    options: [
      { value: "key", label: "SSH key" },
      { value: "password", label: "Password" },
    ],
  },
  {
    key: "host",
    label: "Host",
    placeholder: "IP or hostname, e.g. 5.75.x.x",
    required: true,
  },
  { key: "username", label: "User", placeholder: "e.g. root", required: true },
  { key: "port", label: "Port", placeholder: "22 (optional)" },
  {
    key: "privateKey",
    label: "Private key",
    placeholder: "-----BEGIN OPENSSH PRIVATE KEY-----\n…",
    type: "textarea",
    helpText: "Paste the full PEM (BEGIN…END). Line breaks are preserved.",
  },
  {
    key: "passphrase",
    label: "Key passphrase",
    type: "password",
    placeholder: "if the key is encrypted (optional)",
  },
  {
    key: "password",
    label: "Password",
    type: "password",
    placeholder: "SSH password",
  },
];

/**
 * Add a server to the VPS plugin's list. Calls the `add-server` action, which
 * validates reachability server-side then persists the new config.
 */
export function VpsAddDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded?: () => void;
}) {
  const runAction = useRunPluginAction("VPS");
  const [form, setForm] = useState<Record<string, string>>({});
  const [show, setShow] = useState<Record<string, boolean>>({});

  const missing = VPS_FIELDS.filter(
    (f) => f.required && !form[f.key]?.trim(),
  ).map((f) => f.label);

  const add = async () => {
    if (missing.length) {
      toast.error(`Fill required fields: ${missing.join(", ")}`);
      return;
    }
    // Drop empty strings so optional fields stay undefined server-side.
    const input: Record<string, string> = {};
    for (const [k, v] of Object.entries(form)) {
      if (v && v.trim()) input[k] = v;
    }
    if (!input.authMethod) input.authMethod = "key";
    try {
      const res = await runAction.mutateAsync({
        actionId: "add-server",
        input,
      });
      if (!res.ok) throw new Error(res.message);
      toast.success(res.message);
      onAdded?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add server");
    }
  };

  const authMethod = form["authMethod"] || "key";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a VPS</DialogTitle>
          <DialogDescription>
            citshe SSHes in read-only to report up, load, disk and RAM.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {VPS_FIELDS.map((field) => {
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
                  {field.required && (
                    <span className="text-destructive"> *</span>
                  )}
                </Label>
                <div className="relative">
                  {field.type === "select" ? (
                    <Select
                      value={form[field.key] || field.options?.[0]?.value || ""}
                      onValueChange={(v) => setForm({ ...form, [field.key]: v })}
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
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={add} disabled={runAction.isPending}>
            {runAction.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1.5 h-4 w-4" />
            )}
            Add server
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
