"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Copy,
  Key,
  MoreVertical,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
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
import { formatDistanceToNow } from "@/lib/utils";
import { useApiKeys, useCreateApiKey, useDeleteApiKey } from "@/lib/api/hooks";
import { toast } from "sonner";

export default function ApiKeysPage() {
  const { data: apiKeys = [], isLoading } = useApiKeys();
  const createApiKey = useCreateApiKey();
  const deleteApiKey = useDeleteApiKey();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  const handleCreateKey = async () => {
    try {
      const result = await createApiKey.mutateAsync({ name: newKeyName });
      setGeneratedKey(result.key);
      toast.success("API key created successfully");
    } catch {
      toast.error("Failed to create API key");
    }
  };

  const handleDeleteKey = async (keyId: string) => {
    try {
      await deleteApiKey.mutateAsync(keyId);
      toast.success("API key revoked");
    } catch {
      toast.error("Failed to revoke API key");
    }
  };

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    toast.success("API key copied to clipboard");
  };

  const handleCloseCreateDialog = () => {
    setIsCreateOpen(false);
    setNewKeyName("");
    setGeneratedKey(null);
    setShowKey(false);
  };

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage API keys for programmatic access.
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Create API key
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {generatedKey ? "API key created" : "Create API key"}
              </DialogTitle>
              <DialogDescription>
                {generatedKey
                  ? "Make sure to copy your API key now. You won't be able to see it again!"
                  : "Create a new API key for programmatic access to the API."}
              </DialogDescription>
            </DialogHeader>
            {generatedKey ? (
              <DialogBody className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Your API key</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showKey ? "text" : "password"}
                        value={generatedKey}
                        readOnly
                        className="pr-10 font-mono text-sm"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full"
                        onClick={() => setShowKey(!showKey)}
                      >
                        {showKey ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleCopyKey(generatedKey)}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-warn">
                    This key will only be shown once. Store it securely.
                  </p>
                </div>
              </DialogBody>
            ) : (
              <DialogBody className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="keyName">Key Name</Label>
                  <Input
                    id="keyName"
                    placeholder="My API Key"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    A descriptive name to identify this key
                  </p>
                </div>
              </DialogBody>
            )}
            <DialogFooter>
              {generatedKey ? (
                <Button onClick={handleCloseCreateDialog}>Done</Button>
              ) : (
                <>
                  <Button variant="outline" onClick={handleCloseCreateDialog}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateKey}
                    disabled={!newKeyName || createApiKey.isPending}
                  >
                    {createApiKey.isPending && (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    )}
                    Create key
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="overflow-hidden rounded-md border border-border bg-surface-card">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`flex items-center gap-3 px-3.5 py-3 ${
                i > 0 ? "border-t border-border" : ""
              }`}
            >
              <Skeleton className="size-9 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="size-8 shrink-0 rounded-md" />
            </div>
          ))}
        </div>
      ) : apiKeys.length === 0 ? (
        <EmptyState
          icon={<Key />}
          title="No API keys yet"
          description="Create your first API key to authenticate programmatic access to the API."
          action={
            <Button size="sm" onClick={() => setIsCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create API key
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-surface-card">
          {apiKeys.map((key, i) => (
            <div
              key={key.id}
              className={`flex items-center gap-3 px-3.5 py-3 ${
                i > 0 ? "border-t border-border" : ""
              }`}
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-inset text-muted-foreground">
                <Key className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {key.name}
                  </span>
                  <code className="rounded-sm border border-border bg-surface-inset px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                    {key.prefix}...
                  </code>
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-subtle">
                  <span>Created {formatDistanceToNow(new Date(key.createdAt))}</span>
                  <span>
                    Last used{" "}
                    {key.lastUsedAt
                      ? formatDistanceToNow(new Date(key.lastUsedAt))
                      : "never"}
                  </span>
                  {key.expiresAt ? (
                    <Badge variant="outline">
                      Expires {new Date(key.expiresAt).toLocaleDateString()}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">No expiry</Badge>
                  )}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setRevokeTarget({ id: key.id, name: key.name })}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Revoke
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!revokeTarget} onOpenChange={() => setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently revoke &ldquo;{revokeTarget?.name}&rdquo;. Any applications using this key will stop working immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteApiKey.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (revokeTarget) {
                  handleDeleteKey(revokeTarget.id);
                  setRevokeTarget(null);
                }
              }}
              disabled={deleteApiKey.isPending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
