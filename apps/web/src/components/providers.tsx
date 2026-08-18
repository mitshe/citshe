"use client";

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import { SocketProvider } from "@/lib/socket";
import { ORG_SWITCHED_EVENT } from "@/lib/auth/auth-context";

/**
 * Clears the query cache when the active organization changes, so every hook
 * refetches data scoped to the newly selected org.
 */
function OrgSwitchQueryReset() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const handler = () => {
      queryClient.clear();
      queryClient.invalidateQueries();
    };
    window.addEventListener(ORG_SWITCHED_EVENT, handler);
    return () => window.removeEventListener(ORG_SWITCHED_EVENT, handler);
  }, [queryClient]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10 * 1000, // 10 seconds
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
          },
        },
      }),
  );

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        <OrgSwitchQueryReset />
        <SocketProvider>{children}</SocketProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
