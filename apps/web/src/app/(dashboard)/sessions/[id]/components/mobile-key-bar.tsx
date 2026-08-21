"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from "lucide-react";

/**
 * On-screen key bar for the terminal on touch devices. The soft keyboard can't
 * produce Esc / Tab / Ctrl / arrows, which are required to work in a shell,
 * vim, or Claude Code — this bar sends the raw control sequences to the PTY.
 */

// Control sequences (what a real terminal sends for these keys).
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
}

export function MobileKeyBar({ onSend, onFocus }: MobileKeyBarProps) {
  // When Ctrl is armed, the next printable key becomes Ctrl+<key>.
  const [ctrlArmed, setCtrlArmed] = useState(false);

  const send = (seq: string) => {
    onSend(seq);
  };

  const handlePrintableCombo = (ch: string) => {
    if (ctrlArmed) {
      send(ctrlByte(ch));
      setCtrlArmed(false);
    } else {
      send(ch);
    }
  };

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-t border-border bg-surface-card px-1.5 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Key label="Esc" onClick={() => send(ESC)} />
      <Key label="Tab" onClick={() => send(TAB)} />
      <Key
        label="Ctrl"
        armed={ctrlArmed}
        onClick={() => {
          setCtrlArmed((v) => !v);
          onFocus();
        }}
      />
      {/* Common Ctrl combos as one-taps (respect the armed modifier too) */}
      <Key label="^C" onClick={() => { send(ctrlByte("C")); setCtrlArmed(false); }} />
      <Key label="^D" onClick={() => { send(ctrlByte("D")); setCtrlArmed(false); }} />
      <Key label="^Z" onClick={() => { send(ctrlByte("Z")); setCtrlArmed(false); }} />
      <Key label="^L" onClick={() => { send(ctrlByte("L")); setCtrlArmed(false); }} />

      <div className="mx-0.5 h-6 w-px shrink-0 bg-border" />

      <Key label="/" onClick={() => handlePrintableCombo("/")} />
      <Key label="|" onClick={() => handlePrintableCombo("|")} />
      <Key label="-" onClick={() => handlePrintableCombo("-")} />
      <Key label="~" onClick={() => handlePrintableCombo("~")} />

      <div className="mx-0.5 h-6 w-px shrink-0 bg-border" />

      <Key icon={<ArrowUp className="h-3.5 w-3.5" />} onClick={() => send(ARROW_UP)} />
      <Key icon={<ArrowDown className="h-3.5 w-3.5" />} onClick={() => send(ARROW_DOWN)} />
      <Key icon={<ArrowLeft className="h-3.5 w-3.5" />} onClick={() => send(ARROW_LEFT)} />
      <Key icon={<ArrowRight className="h-3.5 w-3.5" />} onClick={() => send(ARROW_RIGHT)} />

      <div className="mx-0.5 h-6 w-px shrink-0 bg-border" />

      <Key label="Keyboard" onClick={onFocus} wide />
    </div>
  );
}

function Key({
  label,
  icon,
  onClick,
  armed,
  wide,
}: {
  label?: string;
  icon?: React.ReactNode;
  onClick: () => void;
  armed?: boolean;
  wide?: boolean;
}) {
  return (
    <button
      // Keep the terminal from losing focus / avoid the 300ms tap delay.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-inset px-2.5 text-xs font-medium text-foreground active:bg-surface-hover transition-linear",
        wide && "px-3",
        armed && "border-primary bg-primary/15 text-primary",
      )}
    >
      {icon ?? label}
    </button>
  );
}
