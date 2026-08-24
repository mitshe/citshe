"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Terminal, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuthToken } from "@/lib/api/hooks";
import { toast } from "sonner";

/**
 * Where `citshe login` sends the browser. The user (already signed into the
 * panel) confirms the code the CLI printed, then Authorize/Deny.
 */
export default function CliAuthorizePage() {
  const params = useSearchParams();
  const getToken = useAuthToken();

  const [code, setCode] = useState("");
  const [state, setState] = useState<
    "idle" | "checking" | "ready" | "done" | "denied" | "invalid"
  >("idle");
  const [busy, setBusy] = useState(false);

  // Prefill from ?code= and auto-check it.
  useEffect(() => {
    const c = params.get("code");
    if (c) {
      setCode(c.toUpperCase());
      void check(c);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const check = async (value: string) => {
    setState("checking");
    try {
      const token = await getToken();
      const { request } = await api.cliTokens.authRequest(value.trim(), token);
      setState(request && request.status === "pending" ? "ready" : "invalid");
    } catch {
      setState("invalid");
    }
  };

  const approve = async () => {
    setBusy(true);
    try {
      const token = await getToken();
      await api.cliTokens.authApprove(code.trim(), token);
      setState("done");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to authorize");
    } finally {
      setBusy(false);
    }
  };

  const deny = async () => {
    setBusy(true);
    try {
      const token = await getToken();
      await api.cliTokens.authDeny(code.trim(), token);
      setState("denied");
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm text-center">
        {state === "done" ? (
          <>
            <StatusIcon variant="ok">
              <CheckCircle2 className="h-7 w-7" />
            </StatusIcon>
            <h1 className="mt-5 text-xl font-semibold tracking-tight">
              You&apos;re signed in
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Head back to your terminal — the CLI is authorized. You can close
              this tab.
            </p>
          </>
        ) : state === "denied" ? (
          <>
            <StatusIcon variant="danger">
              <XCircle className="h-7 w-7" />
            </StatusIcon>
            <h1 className="mt-5 text-xl font-semibold tracking-tight">
              Login denied
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Nothing was authorized. You can close this tab.
            </p>
          </>
        ) : (
          <>
            <StatusIcon variant="brand">
              <Terminal className="h-7 w-7" />
            </StatusIcon>
            <h1 className="mt-5 text-xl font-semibold tracking-tight">
              Authorize the citshe CLI
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Check that this matches the code shown in your terminal.
            </p>

            <div className="mt-6">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onBlur={() => code && check(code)}
                placeholder="ABCD-EFGH"
                className="h-12 text-center font-mono text-xl font-semibold tracking-[0.3em]"
              />
              {state === "invalid" && (
                <p className="mt-2 text-xs text-danger">
                  That code is invalid or has expired. Start again from your
                  terminal.
                </p>
              )}
            </div>

            <div className="mt-6 flex gap-2.5">
              <Button
                variant="outline"
                className="flex-1"
                onClick={deny}
                disabled={busy || state !== "ready"}
              >
                Deny
              </Button>
              <Button
                className="flex-1"
                onClick={approve}
                disabled={busy || state !== "ready"}
              >
                {busy || state === "checking" ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : null}
                Authorize
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** A single large status icon in a soft tinted circle. */
function StatusIcon({
  variant,
  children,
}: {
  variant: "brand" | "ok" | "danger";
  children: ReactNode;
}) {
  const tint =
    variant === "ok"
      ? "bg-ok/10 text-ok"
      : variant === "danger"
        ? "bg-danger/10 text-danger"
        : "bg-primary/10 text-primary";
  return (
    <div
      className={`mx-auto flex size-16 items-center justify-center rounded-2xl ${tint}`}
    >
      {children}
    </div>
  );
}
