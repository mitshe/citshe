"use client";

import { useState } from "react";
import {
  MessageSquarePlus,
  Loader2,
  Trash2,
  MoreHorizontal,
  History,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useChatConversations,
  useCreateChatConversation,
  useDeleteChatConversation,
  useAICredentials,
} from "@/lib/api/hooks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

interface ChatHistoryPanelProps {
  activeId: string | null;
  onSelect: (id: string | null) => void;
  /** Called on mobile after picking a conversation, to close the drawer. */
  onNavigate?: () => void;
}

export function ChatHistoryList({
  activeId,
  onSelect,
  onNavigate,
}: ChatHistoryPanelProps) {
  const { data: conversations = [], isLoading } = useChatConversations();
  const { data: credentials = [] } = useAICredentials();
  const createConversation = useCreateChatConversation();
  const deleteConversation = useDeleteChatConversation();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  const handleNew = async () => {
    const defaultCred =
      credentials.find((c: { isDefault?: boolean }) => c.isDefault) || credentials[0];
    if (!defaultCred) {
      onSelect(null);
      onNavigate?.();
      return;
    }
    const conv = await createConversation.mutateAsync({ aiCredentialId: defaultCred.id });
    onSelect(conv.id);
    onNavigate?.();
  };

  const handleSelect = (id: string) => {
    onSelect(id);
    onNavigate?.();
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteConversation.mutate(deleteTarget.id);
    if (activeId === deleteTarget.id) onSelect(null);
    setDeleteTarget(null);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="p-2">
        <button
          onClick={handleNew}
          disabled={createConversation.isPending || credentials.length === 0}
          className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
        >
          {createConversation.isPending ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <MessageSquarePlus className="h-4 w-4 shrink-0" />
          )}
          New chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground">
            No conversations yet. Click &ldquo;New chat&rdquo;.
          </p>
        ) : (
          <div className="space-y-0.5">
            {conversations.map((c) => (
              <ConversationItem
                key={c.id}
                title={c.title || "New conversation"}
                isActive={activeId === c.id}
                onSelect={() => handleSelect(c.id)}
                onDelete={() =>
                  setDeleteTarget({ id: c.id, title: c.title || "New conversation" })
                }
              />
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleteTarget?.title}&rdquo; will be permanently deleted along with its messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ConversationItem({
  title,
  isActive,
  onSelect,
  onDelete,
}: {
  title: string;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm cursor-pointer transition-colors",
        isActive
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
      onClick={onSelect}
    >
      <span className="flex-1 truncate pr-6">{title}</span>
      <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="rounded-md p-1 hover:bg-muted transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Mobile-only button + slide-over drawer holding the history list. */
export function ChatHistoryDrawer(props: ChatHistoryPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <History className="h-3.5 w-3.5" />
        History
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-72 bg-background border-r border-border flex flex-col">
            <div className="flex h-12 items-center justify-between border-b px-3">
              <span className="text-sm font-medium">Chat history</span>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ChatHistoryList {...props} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
