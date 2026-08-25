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
  readOnly = false,
}: {
  sessionId: string;
  terminalId: string;
  isRunning: boolean;
  cmd?: string[];
  isVisible?: boolean;
  /**
   * Read-only "watch" mode: render the live stream but never send input and
   * never (re)start the attach. Used by the session's "Progress" tab, which
   * shows the SAME formatted stream as the interactive Terminal tab (the latter
   * owns the attach; a second start() would flap the tmux client). No input
   * handler, no mobile key bar, no cursor blink.
   */
  readOnly?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const xtermRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitRef = useRef<any>(null);
  const touchCleanupRef = useRef<(() => void) | null>(null);
  const { socket, subscribeToSession, unsubscribeFromSession } = useSocket();
  // Live socket for handlers created once at mount (e.g. touch scroll).
  const socketRef = useRef(socket);
  socketRef.current = socket;
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

      // WebGL renderer for smooth scrolling/redraw on mobile (falls back to the
      // default DOM renderer if the context is lost or unavailable).
      let WebglAddon: typeof import("@xterm/addon-webgl").WebglAddon | undefined;
      try {
        ({ WebglAddon } = await import("@xterm/addon-webgl"));
      } catch {
        WebglAddon = undefined;
      }
      if (disposed) return;

      terminal = new Terminal({
        cursorBlink: !readOnly,
        disableStdin: readOnly,
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
        // Smoother wheel scrolling on desktop (default 1 line feels sticky).
        scrollSensitivity: 3,
        fastScrollSensitivity: 8,
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

      // WebGL renderer (best perf on mobile). If the GPU context is lost, xterm
      // disposes the addon and reverts to the DOM renderer automatically.
      if (WebglAddon) {
        try {
          const webgl = new WebglAddon();
          webgl.onContextLoss(() => webgl.dispose());
          terminal.loadAddon(webgl);
        } catch {
          /* WebGL unavailable — DOM renderer is fine */
        }
      }

      // iOS zooms the whole page when you focus an input whose font is < 16px.
      // xterm's hidden textarea inherits the (12px) terminal font, so pin it to
      // 16px — it's invisible, so this only affects zoom behavior, not layout.
      const helper = termRef.current!.querySelector(
        ".xterm-helper-textarea",
      ) as HTMLElement | null;
      if (helper) helper.style.fontSize = "16px";

      // Touch scrolling for a tmux terminal. Our terminals ARE tmux windows,
      // and tmux keeps the real scrollback (xterm only sees a live stream, so
      // xterm.scrollLines scrolls almost nothing). tmux has `mouse on`, so we
      // translate a vertical swipe into SGR mouse-wheel events sent to the PTY —
      // tmux then scrolls its history (enters copy-mode) or passes the wheel to
      // a full-screen app (Claude Code, vim, less). One unified path.
      // Attach to the terminal ROOT: with WebGL a canvas overlays the viewport
      // and swallows its touch events, so the root is the reliable target.
      {
        const root = termRef.current!;
        root.style.setProperty("touch-action", "pan-y");
        // SGR mouse wheel at cell (1,1): button 64 = wheel up, 65 = wheel down.
        const wheel = (up: boolean) =>
          `\x1b[<${up ? 64 : 65};1;1M`;
        let touchStartY = 0;
        let touchAccum = 0;
        const onTouchStart = (e: TouchEvent) => {
          touchStartY = e.touches[0]?.clientY ?? 0;
          touchAccum = 0;
        };
        const onTouchMove = (e: TouchEvent) => {
          const term = xtermRef.current;
          if (!term) return;
          const y = e.touches[0]?.clientY ?? 0;
          const dy = touchStartY - y;
          touchStartY = y;
          touchAccum += dy;
          const cell =
            (term as { _core?: { _renderService?: { dimensions?: { css?: { cell?: { height?: number } } } } } })
              ._core?._renderService?.dimensions?.css?.cell?.height || 18;
          // One wheel "notch" per ~1.5 cells of drag (a notch = ~3 lines in tmux).
          const notches = Math.trunc(touchAccum / (cell * 1.5));
          if (notches !== 0) {
            const up = notches < 0; // dragging DOWN (finger down) scrolls UP
            const steps = Math.min(Math.abs(notches), 8);
            const seq = wheel(up).repeat(steps);
            socketRef.current?.emit("session:input", { terminalId, input: seq });
            touchAccum -= notches * cell * 1.5;
            e.preventDefault();
          }
        };
        root.addEventListener("touchstart", onTouchStart, { passive: true });
        root.addEventListener("touchmove", onTouchMove, { passive: false });
        touchCleanupRef.current = () => {
          root.removeEventListener("touchstart", onTouchStart);
          root.removeEventListener("touchmove", onTouchMove);
        };
      }

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
      touchCleanupRef.current?.();
      touchCleanupRef.current = null;
      terminal?.dispose();
      xtermRef.current = null;
      fitRef.current = null;
      setTerminalReady(false);
    };
    // Init runs once — socket/terminalId are read live inside the touch handler
    // and are stable; re-running would tear down and rebuild the terminal.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Forward keyboard input via WebSocket (never in read-only "watch" mode).
  useEffect(() => {
    if (readOnly || !xtermRef.current || !socket || !isRunning) return;

    const disposable = xtermRef.current.onData((data: string) => {
      socket.emit("session:input", { terminalId, input: data });
    });

    return () => disposable.dispose();
  }, [terminalReady, socket, terminalId, isRunning, readOnly]);

  // Start terminal process. Read-only "watch" tabs (Progress) do NOT start the
  // attach — the interactive Terminal tab owns it; both render the same output
  // via the shared session:output stream, so a second start() would only flap
  // the tmux client. We still hydrate the scrollback buffer below.
  useEffect(() => {
    if (readOnly || !terminalReady || !isRunning) return;

    startTerminal
      .mutateAsync({ sessionId, terminalId, cmd })
      .then((res) => {
        if (res.buffer && xtermRef.current) {
          xtermRef.current.write(res.buffer);
        }
        // Push the fitted size to the PTY right after it starts — otherwise the
        // backend exec keeps Docker's default 80×24 and full-screen TUIs
        // (Claude Code) draw in a narrow band instead of filling the panel.
        requestAnimationFrame(() => {
          try {
            fitRef.current?.fit();
            const term = xtermRef.current;
            if (term && socket) {
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

  // Keep the terminal + key bar ABOVE the software keyboard. iOS doesn't shrink
  // the layout viewport for the keyboard (100dvh stays full), so we measure the
  // overlap via visualViewport and pad the bottom by that much, then refit xterm
  // to the smaller area. On Android/desktop the inset resolves to 0.
  const [kbInset, setKbInset] = useState(0);
  useEffect(() => {
    if (!isTouch) return;
    const vv = window.visualViewport;
    if (!vv) return;
    let raf = 0;
    const onResize = () => {
      const overlap = Math.max(
        0,
        window.innerHeight - vv.height - vv.offsetTop,
      );
      // Ignore tiny fluctuations (URL bar, rounding).
      setKbInset(overlap > 80 ? Math.round(overlap) : 0);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          fitRef.current?.fit();
          const term = xtermRef.current;
          if (term && socket && isRunning) {
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
    };
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
      cancelAnimationFrame(raf);
    };
  }, [isTouch, socket, isRunning, terminalId]);

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
        // Lift everything above the software keyboard (iOS). 0 on desktop.
        paddingBottom: kbInset ? `${kbInset}px` : undefined,
        transition: "padding-bottom 120ms ease",
      }}
    >
      <div
        ref={containerRef}
        // On touch devices, tapping the terminal must NOT open the keyboard —
        // that would fight scrolling. The keyboard only opens via the ⌨ button
        // in the key bar. On desktop, a click focuses as usual.
        onClick={isTouch || readOnly ? undefined : focusTerminal}
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
      {isTouch && isRunning && !readOnly && (
        <MobileKeyBar
          onSend={sendSequence}
          onFocus={focusTerminal}
          // Only pad for the home indicator when the keyboard is closed —
          // otherwise the bar sits right on top of the keyboard.
          safeBottom={kbInset === 0}
        />
      )}
    </div>
  );
}
