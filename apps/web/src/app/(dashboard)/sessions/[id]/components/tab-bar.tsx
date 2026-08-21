"use client";

import { X, Terminal as TerminalIcon, FileText, Globe, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { showContextMenu } from "./context-menu";

export interface Tab {
  id: string;
  title: string;
  type: "terminal" | "file" | "browser";
  filePath?: string;
  terminalId?: string;
  cmd?: string[];
  closeable: boolean;
}

export function TabBar({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onCloseOthers,
  onCloseAll,
  onRename,
  onNewTerminal,
}: {
  tabs: Tab[];
  activeTabId: string;
  onTabClick: (id: string) => void;
  onTabClose: (id: string) => void;
  onCloseOthers?: (id: string) => void;
  onCloseAll?: () => void;
  onRename?: (id: string) => void;
  onNewTerminal?: () => void;
}) {
  return (
    <div className="flex items-center border-b border-border bg-surface-card overflow-x-auto shrink-0">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn(
            "group relative flex items-center gap-1.5 px-3 py-2 text-xs border-r border-border cursor-pointer select-none shrink-0 transition-linear",
            activeTabId === tab.id
              ? "bg-surface-inset text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary"
              : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
          )}
          onClick={() => onTabClick(tab.id)}
          onAuxClick={(e) => {
            if (e.button === 1 && tab.closeable) {
              e.preventDefault();
              onTabClose(tab.id);
            }
          }}
          onContextMenu={(e) => {
            const items = [];

            if (tab.filePath) {
              items.push({
                label: "Copy Path",
                action: () =>
                  navigator.clipboard.writeText(tab.filePath || ""),
              });
              items.push({
                label: "Copy Full Path",
                action: () =>
                  navigator.clipboard.writeText(
                    `/workspace/${tab.filePath}`,
                  ),
              });
            }

            if (tab.closeable) {
              items.push({
                label: "Close",
                action: () => onTabClose(tab.id),
                separator: items.length > 0,
              });

              if (onCloseOthers) {
                items.push({
                  label: "Close Others",
                  action: () => onCloseOthers(tab.id),
                });
              }
            }

            if (onRename) {
              items.push({
                label: "Rename",
                action: () => onRename(tab.id),
                separator: true,
              });
            }

            if (onCloseAll) {
              items.push({
                label: "Close All Files",
                action: () => onCloseAll(),
              });
            }

            if (items.length > 0) {
              showContextMenu(e, items);
            }
          }}
        >
          {tab.type === "terminal" ? (
            <TerminalIcon className="w-3.5 h-3.5" />
          ) : tab.type === "browser" ? (
            <Globe className="w-3.5 h-3.5" />
          ) : (
            <FileText className="w-3.5 h-3.5" />
          )}
          <span className="max-w-[150px] truncate">{tab.title}</span>
          {tab.closeable && (
            <button
              className="ml-1 p-0.5 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-surface-hover hover:text-foreground transition-linear"
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.id);
              }}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}
      {onNewTerminal && (
        <button
          onClick={onNewTerminal}
          className="flex items-center justify-center w-8 self-stretch shrink-0 text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-linear"
          title="New Terminal"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
