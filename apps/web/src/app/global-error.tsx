"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body className="bg-background text-foreground">
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="max-w-md text-center">
            <div className="mb-6 flex justify-center">
              <div className="rounded-lg border border-border bg-surface-card p-4">
                <AlertCircle className="h-8 w-8 text-danger" />
              </div>
            </div>

            <h2 className="mb-2 text-xl font-semibold text-foreground">
              Something went wrong
            </h2>
            <p className="mb-6 text-muted-foreground">
              A critical error occurred. Please refresh the page.
            </p>

            <button
              onClick={reset}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-linear hover:bg-primary/90"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
