"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSocket } from "@/lib/socket/socket-context";
import { useStartTerminal } from "@/lib/api/hooks";
import { MobileKeyBar } from "./mobile-key-bar";

export function TerminalView({
  sessionId,
  terminalId,
  isRunning,
  cmd,
  isVisible = true,
}: {
  sessionId: string;
  terminalId: string;
  isRunning: boolean;
  cmd?: string[];
  isVisible?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const xtermRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitRef = useRef<any>(null);
  const { socket, subscribeToSession, unsubscribeFromSession } = useSocket();
  const startTerminal = useStartTerminal();
  const [terminalReady, setTerminalReady] = useState(false);

  // Initialize xterm
  useEffect(() => {
    if (!termRef.current || !containerRef.current) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let terminal: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fitAddon: any;
    let disposed = false;

    const init = async () => {
      await new Promise<void>((resolve) => {
        const check = () => {
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect && rect.height > 50 && rect.width > 50) resolve();
          else requestAnimationFrame(check);
        };
        check();
      });

      if (disposed) return;

      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      // @ts-expect-error CSS import
      await import("@xterm/xterm/css/xterm.css");

      if (disposed) return;

      terminal = new Terminal({
        cursorBlink: true,
        fontFamily:
          "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        // Smaller on phones so a usable number of columns fits at ~375px.
        fontSize:
          typeof window !== "undefined" && window.innerWidth < 640 ? 12 : 13,
        lineHeight: 1.2,
        // Generous scrollback so long Claude Code sessions don't lose history.
        scrollback: 10000,
        // Keep the viewport pinned to the newest output as it streams in.
        scrollOnUserInput: true,
        theme: {
          // Aligned to the dark DS: surface-inset bg, accent (indigo) cursor,
          // translucent accent selection.
          background: "#161619",
          foreground: "#ececed",
          cursor: "#7c7ff5",
          cursorAccent: "#161619",
          selectionBackground: "rgba(124, 127, 245, 0.24)",
          black: "#18181b",
          red: "#ef4444",
          green: "#22c55e",
          yellow: "#eab308",
          blue: "#3b82f6",
          magenta: "#a855f7",
          cyan: "#06b6d4",
          white: "#e4e4e7",
          brightBlack: "#52525b",
          brightRed: "#f87171",
          brightGreen: "#4ade80",
          brightYellow: "#facc15",
          brightBlue: "#60a5fa",
          brightMagenta: "#c084fc",
          brightCyan: "#22d3ee",
          brightWhite: "#fafafa",
        },
      });

      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(termRef.current!);

      // The monospace font loads asynchronously; the first fit often lands
      // before glyph metrics are final, leaving the terminal narrower than the
      // panel (wasted space). Refit a few times as things settle, and again
      // once the web font is ready.
      const refit = () => {
        if (disposed) return;
        try {
          fitAddon.fit();
        } catch {
          /* ignore */
        }
      };
      requestAnimationFrame(refit);
      setTimeout(refit, 60);
      setTimeout(refit, 250);
      (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready
        ?.then(refit)
        .catch(() => {});

      xtermRef.current = terminal;
      fitRef.current = fitAddon;
      setTerminalReady(true);
    };

    init();

    return () => {
      disposed = true;
      terminal?.dispose();
      xtermRef.current = null;
      fitRef.current = null;
      setTerminalReady(false);
    };
  }, []);

  // Resize handling — fit xterm and notify backend PTY
  useEffect(() => {
    if (!fitRef.current || !containerRef.current || !socket) return;

    const handleResize = () => {
      try {
        fitRef.current?.fit();
        const term = xtermRef.current;
        if (term) {
          socket.emit("session:resize", {
            terminalId,
            cols: term.cols,
            rows: term.rows,
          });
        }
      } catch {
        /* ignore */
      }
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [terminalReady, socket, terminalId]);

  // Refit when tab becomes visible
  useEffect(() => {
    if (!isVisible || !fitRef.current || !socket) return;
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
        const term = xtermRef.current;
        if (term) {
          socket.emit("session:resize", {
            terminalId,
            cols: term.cols,
            rows: term.rows,
          });
        }
      } catch {
        /* ignore */
      }
    });
  }, [isVisible, terminalReady, socket, terminalId]);

  // Reliability: when the socket reconnects (e.g. the tunnel dropped the WS),
  // re-subscribe to the session and re-sync the terminal size + scroll so the
  // TUI (Claude Code) redraws correctly instead of staying frozen/misaligned.
  useEffect(() => {
    if (!socket || !sessionId || !terminalReady) return;

    const handleReconnect = () => {
      subscribeToSession(sessionId);
      requestAnimationFrame(() => {
        try {
          fitRef.current?.fit();
          const term = xtermRef.current;
          if (term) {
            socket.emit("session:resize", {
              terminalId,
              cols: term.cols,
              rows: term.rows,
            });
            term.scrollToBottom();
          }
        } catch {
          /* ignore */
        }
      });
    };

    socket.on("connect", handleReconnect);
    return () => {
      socket.off("connect", handleReconnect);
    };
  }, [socket, sessionId, terminalId, terminalReady, subscribeToSession]);

  // Subscribe to terminal output (throttled writes to prevent artifacts)
  useEffect(() => {
    if (!socket || !sessionId || !terminalReady) return;

    subscribeToSession(sessionId);

    let buffer = "";
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (buffer && xtermRef.current) {
        xtermRef.current.write(buffer);
        buffer = "";
      }
      flushTimer = null;
    };

    const handleOutput = (payload: {
      terminalId: string;
      data: string;
    }) => {
      if (payload.terminalId === terminalId) {
        buffer += payload.data;
        if (!flushTimer) {
          flushTimer = setTimeout(flush, 16); // ~60fps
        }
      }
    };

    socket.on("session:output", handleOutput);

    return () => {
      socket.off("session:output", handleOutput);
      if (flushTimer) clearTimeout(flushTimer);
      flush();
    };
  }, [
    socket,
    sessionId,
    terminalId,
    terminalReady,
    subscribeToSession,
    unsubscribeFromSession,
  ]);

  // Forward keyboard input via WebSocket
  useEffect(() => {
    if (!xtermRef.current || !socket || !isRunning) return;

    const disposable = xtermRef.current.onData((data: string) => {
      socket.emit("session:input", { terminalId, input: data });
    });

    return () => disposable.dispose();
  }, [terminalReady, socket, terminalId, isRunning]);

  // Start terminal process
  useEffect(() => {
    if (!terminalReady || !isRunning) return;

    startTerminal
      .mutateAsync({ sessionId, terminalId, cmd })
      .then((res) => {
        if (res.buffer && xtermRef.current) {
          xtermRef.current.write(res.buffer);
        }
      })
      .catch(() => {
        // ignore
      });
  }, [terminalReady, isRunning, sessionId, terminalId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Mobile support ─────────────────────────────────────────────
  // On touch devices the on-screen keyboard and special keys (Esc, Tab,
  // Ctrl, arrows) are essential to actually work in the terminal.
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    setIsTouch(
      typeof window !== "undefined" &&
        window.matchMedia("(pointer: coarse)").matches,
    );
  }, []);

  // Send a raw sequence to the PTY (used by the mobile key bar).
  const sendSequence = useCallback(
    (seq: string) => {
      if (!socket || !isRunning) return;
      socket.emit("session:input", { terminalId, input: seq });
      xtermRef.current?.focus();
    },
    [socket, isRunning, terminalId],
  );

  // Focus the terminal (pops up the on-screen keyboard on mobile).
  const focusTerminal = useCallback(() => {
    xtermRef.current?.focus();
  }, []);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#161619",
      }}
    >
      <div
        ref={containerRef}
        onClick={focusTerminal}
        onTouchStart={isTouch ? focusTerminal : undefined}
        // Small breathing room so text isn't glued to the panel edge; the fit
        // addon accounts for this padding when computing cols/rows.
        style={{
          width: "100%",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          padding: "6px 8px",
          background: "#161619",
        }}
      >
        <div ref={termRef} style={{ width: "100%", height: "100%" }} />
      </div>
      {isTouch && isRunning && (
        <MobileKeyBar onSend={sendSequence} onFocus={focusTerminal} />
      )}
    </div>
  );
}
