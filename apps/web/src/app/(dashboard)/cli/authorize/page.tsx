"use client";

import { useEffect, useState } from "react";
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
    <div className="mx-auto w-full max-w-md px-4 py-16">
      <div className="rounded-xl border border-border bg-surface-card p-6 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-surface-inset text-primary">
          <Terminal className="h-6 w-6" />
        </div>

        {state === "done" ? (
          <>
            <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-ok" />
            <h1 className="text-lg font-semibold">You&apos;re signed in</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Head back to your terminal — the CLI is authorized.
            </p>
          </>
        ) : state === "denied" ? (
          <>
            <XCircle className="mx-auto mb-2 h-8 w-8 text-danger" />
            <h1 className="text-lg font-semibold">Login denied</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              You can close this tab.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold">Authorize the citshe CLI</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Confirm the code shown in your terminal.
            </p>

            <div className="mt-4">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onBlur={() => code && check(code)}
                placeholder="ABCD-EFGH"
                className="text-center font-mono text-lg tracking-widest"
              />
              {state === "invalid" && (
                <p className="mt-2 text-xs text-danger">
                  That code is invalid or expired.
                </p>
              )}
            </div>

            <div className="mt-5 flex gap-2">
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
