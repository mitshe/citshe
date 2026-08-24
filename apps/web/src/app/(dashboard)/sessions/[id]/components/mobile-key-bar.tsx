"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ClipboardPaste,
  Keyboard as KeyboardIcon,
} from "lucide-react";

/**
 * On-screen key bar for the terminal on touch devices. The soft keyboard can't
 * produce Esc / Tab / Ctrl / Alt / arrows, which are required to work in a
 * shell, vim, or Claude Code — this bar sends the raw control sequences to the
 * PTY. Ctrl and Alt are latching modifiers: tap one, then the next key is
 * modified (and the modifier clears). A Paste button reads the clipboard.
 */

const ESC = "\x1b";
const TAB = "\t";
const ARROW_UP = "\x1b[A";
const ARROW_DOWN = "\x1b[B";
const ARROW_RIGHT = "\x1b[C";
const ARROW_LEFT = "\x1b[D";

/** Ctrl+<letter> → control byte (Ctrl+A = 0x01 ... Ctrl+Z = 0x1a). */
function ctrlByte(ch: string): string {
  const code = ch.toUpperCase().charCodeAt(0);
  if (code >= 64 && code <= 95) return String.fromCharCode(code - 64);
  return ch;
}

interface MobileKeyBarProps {
  onSend: (seq: string) => void;
  onFocus: () => void;
  /** Add home-indicator safe-area padding (only when the keyboard is closed). */
  safeBottom?: boolean;
}

export function MobileKeyBar({ onSend, onFocus, safeBottom }: MobileKeyBarProps) {
  // Latching modifiers: when armed, the next key is modified, then it clears.
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const [altArmed, setAltArmed] = useState(false);

  const clearMods = () => {
    setCtrlArmed(false);
    setAltArmed(false);
  };

  // Send a printable/base key, applying any armed modifiers.
  const sendKey = (ch: string) => {
    let seq = ctrlArmed ? ctrlByte(ch) : ch;
    if (altArmed) seq = ESC + seq; // Alt = ESC prefix
    onSend(seq);
    clearMods();
  };

  // Send a raw control sequence (arrows, Esc, Tab); Alt still prefixes.
  const sendSeq = (seq: string) => {
    onSend(altArmed ? ESC + seq : seq);
    clearMods();
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) onSend(text);
    } catch {
      /* clipboard blocked — no-op */
    }
    onFocus();
  };

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 overflow-x-auto border-t border-border bg-surface-card px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        safeBottom && "pb-safe",
      )}
    >
      {/* Keyboard first: on touch, this is the ONLY way to open the soft
          keyboard (tapping the terminal just scrolls). Accented so it stands
          out as the primary action. */}
      <Key
        icon={<KeyboardIcon className="h-4 w-4" />}
        onClick={onFocus}
        aria-label="Show keyboard"
        primary
      />

      <Divider />

      <Key label="Esc" onClick={() => sendSeq(ESC)} />
      <Key label="Tab" onClick={() => sendSeq(TAB)} />
      <Key
        label="Ctrl"
        armed={ctrlArmed}
        onClick={() => {
          setCtrlArmed((v) => !v);
          onFocus();
        }}
      />
      <Key
        label="Alt"
        armed={altArmed}
        onClick={() => {
          setAltArmed((v) => !v);
          onFocus();
        }}
      />

      <Divider />

      {/* Common Ctrl combos as one-taps. */}
      <Key label="^C" onClick={() => { onSend(ctrlByte("C")); clearMods(); }} />
      <Key label="^D" onClick={() => { onSend(ctrlByte("D")); clearMods(); }} />
      <Key label="^Z" onClick={() => { onSend(ctrlByte("Z")); clearMods(); }} />
      <Key label="^L" onClick={() => { onSend(ctrlByte("L")); clearMods(); }} />

      <Divider />

      <Key label="/" onClick={() => sendKey("/")} />
      <Key label="|" onClick={() => sendKey("|")} />
      <Key label="-" onClick={() => sendKey("-")} />
      <Key label="~" onClick={() => sendKey("~")} />

      <Divider />

      <Key icon={<ArrowUp className="h-4 w-4" />} onClick={() => sendSeq(ARROW_UP)} />
      <Key icon={<ArrowDown className="h-4 w-4" />} onClick={() => sendSeq(ARROW_DOWN)} />
      <Key icon={<ArrowLeft className="h-4 w-4" />} onClick={() => sendSeq(ARROW_LEFT)} />
      <Key icon={<ArrowRight className="h-4 w-4" />} onClick={() => sendSeq(ARROW_RIGHT)} />

      <Divider />

      <Key icon={<ClipboardPaste className="h-4 w-4" />} onClick={paste} aria-label="Paste" />
    </div>
  );
}

function Divider() {
  return <div className="mx-0.5 h-6 w-px shrink-0 bg-border" />;
}

function Key({
  label,
  icon,
  onClick,
  armed,
  primary,
  "aria-label": ariaLabel,
}: {
  label?: string;
  icon?: React.ReactNode;
  onClick: () => void;
  armed?: boolean;
  /** Accented look — for the primary action (the keyboard toggle). */
  primary?: boolean;
  "aria-label"?: string;
}) {
  return (
    <button
      // Keep the terminal from losing focus / avoid the 300ms tap delay.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={armed}
      className={cn(
        "flex h-9 min-w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-inset px-3 text-sm font-medium text-foreground transition-linear active:bg-surface-hover",
        armed && "border-primary bg-primary/15 text-primary",
        primary &&
          "border-primary/60 bg-primary/15 text-primary active:bg-primary/25",
      )}
    >
      {icon ?? label}
    </button>
  );
}
